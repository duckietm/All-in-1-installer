// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	inserted: [] as any[],
	upsert: null as any,
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb(() => []);
	return {
		...schema,
		db: {
			...fake,
			insert: () => ({
				values: (v: any) => {
					state.inserted.push(v);
					return {
						onDuplicateKeyUpdate: (u: any) => {
							state.upsert = u;
							return Promise.resolve([{ affectedRows: 1 }]);
						},
					};
				},
			}),
		},
	};
});

const perm = vi.hoisted(() => ({ getCtx: vi.fn(), canAccess: vi.fn() }));
vi.mock("@/lib/permissions", async () => ({
	...(await import("@/lib/permission-slugs")),
	getApiAdminContext: perm.getCtx,
	canAccess: perm.canAccess,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
	rateLimit: vi.fn().mockResolvedValue({ ok: true, retryAfter: 0 }),
	clientIp: vi.fn().mockResolvedValue("127.0.0.1"),
}));
vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: vi.fn(),
}));

const withCatalogExportMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/catalog-git-queue", () => ({
	withCatalogExport: withCatalogExportMock,
}));

const deleteImportedItemMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/furni-import", () => ({
	deleteImportedItem: deleteImportedItemMock,
}));

const reloadMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { reload: reloadMock },
}));

import {
	deleteImportedFurni,
	setFurnidataTranslateEnabled,
} from "./import-furni";

const ctx = {
	session: { user: { id: 7, username: "admin", rank: 7, name: "admin" } },
	permissions: { has: () => true },
};

beforeEach(() => {
	vi.clearAllMocks();
	state.inserted = [];
	state.upsert = null;
	perm.getCtx.mockResolvedValue(ctx);
	perm.canAccess.mockReturnValue(true);
	withCatalogExportMock.mockImplementation((fn: () => unknown) => fn());
	deleteImportedItemMock.mockResolvedValue({
		spriteId: 5,
		deletedFiles: ["chair.nitro"],
		errors: [],
	});
	reloadMock.mockResolvedValue(undefined);
});

describe("deleteImportedFurni", () => {
	it.each([
		["no context", null],
		["permission denied", "denied"],
	])("returns Unauthorized when %s", async (_label, mode) => {
		if (mode === null) perm.getCtx.mockResolvedValue(null);
		else perm.canAccess.mockReturnValue(false);
		const res = await deleteImportedFurni({ classname: "chair" });
		expect(res).toEqual({ ok: false, error: "Unauthorized" });
		expect(withCatalogExportMock).not.toHaveBeenCalled();
	});

	it("validates the classname before touching the catalog export", async () => {
		const res = await deleteImportedFurni({ classname: "   " });
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toBe("Validation failed");
		expect(withCatalogExportMock).not.toHaveBeenCalled();
	});

	it("runs the deletion inside the catalog export wrapper", async () => {
		const res = await deleteImportedFurni({ classname: "chair" });
		expect(res).toEqual({
			ok: true,
			data: { spriteId: 5, deletedFiles: ["chair.nitro"], errors: [] },
		});
		expect(withCatalogExportMock).toHaveBeenCalledTimes(1);
		expect(deleteImportedItemMock).toHaveBeenCalledWith("chair");
	});
});

describe("setFurnidataTranslateEnabled", () => {
	it("persists an enabled value, reloads settings and reports success", async () => {
		const res = await setFurnidataTranslateEnabled({ enabled: true });
		expect(res).toEqual({ ok: true, data: { enabled: true } });
		expect(state.inserted).toContainEqual({
			key: "furnidata_translate_enabled",
			value: "1",
		});
		expect(state.upsert).toEqual({ set: { value: "1" } });
		expect(reloadMock).toHaveBeenCalledTimes(1);
	});

	it("persists a disabled value", async () => {
		const res = await setFurnidataTranslateEnabled({ enabled: false });
		expect(res).toEqual({ ok: true, data: { enabled: false } });
		expect(state.inserted).toContainEqual({
			key: "furnidata_translate_enabled",
			value: "0",
		});
	});

	it("rejects invalid input types", async () => {
		const res = await setFurnidataTranslateEnabled({
			enabled: "yes",
		} as never);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toBe("Validation failed");
		expect(reloadMock).not.toHaveBeenCalled();
	});

	it("requires the assets import permission", async () => {
		perm.canAccess.mockReturnValue(false);
		const res = await setFurnidataTranslateEnabled({ enabled: true });
		expect(res).toEqual({ ok: false, error: "Unauthorized" });
		expect(reloadMock).not.toHaveBeenCalled();
	});
});
