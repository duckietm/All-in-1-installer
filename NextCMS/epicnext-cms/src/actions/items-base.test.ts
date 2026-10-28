// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	existing: [{ id: 1 }] as any[],
	set: null as any,
	updateError: null as Error | null,
	inserted: [] as any[],
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb(() => state.existing);
	return {
		...schema,
		db: {
			...fake,
			update: () => ({
				set: (v: any) => {
					state.set = v;
					return {
						where: () =>
							state.updateError
								? Promise.reject(state.updateError)
								: Promise.resolve([{ affectedRows: 1 }]),
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

const rconMock = vi.hoisted(() => ({ updateCatalog: vi.fn() }));
vi.mock("@/lib/services/rcon", () => ({ rcon: rconMock }));

const logStaffActivityMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: logStaffActivityMock,
}));

const revalidatePathMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { updateItemsBase } from "./items-base";

const ctx = {
	session: { user: { id: 7, username: "admin", rank: 7, name: "admin" } },
	permissions: { has: () => true },
};

beforeEach(() => {
	vi.clearAllMocks();
	state.existing = [{ id: 1 }];
	state.set = null;
	state.updateError = null;
	perm.getCtx.mockResolvedValue(ctx);
	perm.canAccess.mockReturnValue(true);
	rconMock.updateCatalog.mockResolvedValue(true);
	logStaffActivityMock.mockResolvedValue(undefined);
});

describe("updateItemsBase", () => {
	it("returns Unauthorized when no admin context exists", async () => {
		perm.getCtx.mockResolvedValue(null);
		const res = await updateItemsBase({ id: 1, fields: { publicName: "x" } });
		expect(res).toEqual({ ok: false, error: "Unauthorized" });
		expect(state.set).toBeNull();
	});

	it("returns Unauthorized when the permission check denies access", async () => {
		perm.canAccess.mockReturnValue(false);
		const res = await updateItemsBase({ id: 1, fields: { publicName: "x" } });
		expect(res).toEqual({ ok: false, error: "Unauthorized" });
		expect(state.set).toBeNull();
	});

	it("rejects requests with no whitelisted fields", async () => {
		const res = await updateItemsBase({
			id: 1,
			fields: { notAllowed: 1, other: "x" },
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toBe("No valid fields to update");
		expect(state.set).toBeNull();
	});

	it("reports a missing item", async () => {
		state.existing = [];
		const res = await updateItemsBase({ id: 3, fields: { publicName: "x" } });
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toBe("Item not found");
		expect(state.set).toBeNull();
	});

	it("validates the input schema before running the handler", async () => {
		const res = await updateItemsBase({ id: 0, fields: { publicName: "x" } });
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toBe("Validation failed");
		expect(state.set).toBeNull();
	});

	it("persists only allowed fields and coerces numeric values", async () => {
		const res = await updateItemsBase({
			id: 1,
			fields: {
				publicName: "Chair",
				width: "2",
				length: "3",
				stackHeight: "1.5",
				spriteId: "44",
				allowStack: "1",
				allowSit: "0",
				interactionModesCount: "4",
				effectIdMale: "9",
				customparams: "{}",
				notAllowed: "nope",
				itemName: undefined,
			},
		});

		expect(res).toEqual({ ok: true, data: { id: 1 } });
		expect(state.set).toMatchObject({
			publicName: "Chair",
			width: 2,
			length: 3,
			stackHeight: 1.5,
			spriteId: 44,
			allowStack: 1,
			allowSit: 0,
			interactionModesCount: 4,
			effectIdMale: 9,
			customparams: "{}",
		});
		expect(state.set).not.toHaveProperty("notAllowed");
		expect(state.set).not.toHaveProperty("itemName");
		expect(rconMock.updateCatalog).toHaveBeenCalled();
		expect(logStaffActivityMock).toHaveBeenCalledWith(
			expect.objectContaining({
				staffId: 7,
				action: "items_base_update",
				targetType: "items_base",
				targetId: 1,
			}),
		);
		expect(revalidatePathMock).toHaveBeenCalledWith("/admin/items");
		expect(revalidatePathMock).toHaveBeenCalledWith("/admin/items/1");
		expect(revalidatePathMock).toHaveBeenCalledWith("/admin/catalog");
	});

	it("continues when the RCON catalog refresh fails", async () => {
		rconMock.updateCatalog.mockRejectedValue(new Error("rcon down"));
		const res = await updateItemsBase({
			id: 1,
			fields: { interactionType: "gate" },
		});
		expect(res).toEqual({ ok: true, data: { id: 1 } });
		expect(logStaffActivityMock).toHaveBeenCalled();
	});

	it("maps a database failure to an internal error result", async () => {
		state.updateError = new Error("boom");
		const res = await updateItemsBase({ id: 1, fields: { type: "s" } });
		expect(res).toEqual({ ok: false, error: "Internal server error" });
	});
});
