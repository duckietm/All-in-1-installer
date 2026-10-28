// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeDbConfig = vi.hoisted(() => ({
	ops: [] as any[],
	insertResult: [{ insertId: 1 }],
	fail: undefined as any,
}));

const mockRequirePermissionRateLimited = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());
const mockReload = vi.hoisted(() => vi.fn());
const mockClearFurnidata = vi.hoisted(() => vi.fn());
const mockClearBadge = vi.hoisted(() => vi.fn());
const mockAdminAction = vi.hoisted(() => vi.fn());
const capturedAdminAction = vi.hoisted(() => ({ calls: [] as any[] }));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeActionDb } = await import("@/test/fake-db-actions");
	return { ...schema, db: createFakeActionDb(fakeDbConfig) };
});

vi.mock("@/lib/admin/guard", () => ({
	requirePermission: mockRequirePermissionRateLimited,
	requirePermissionRateLimited: mockRequirePermissionRateLimited,
}));

vi.mock("@/lib/permissions", () => ({
	PERMS: { SETTINGS_EDIT: "admin.settings.edit" },
}));

vi.mock("next/cache", () => ({
	revalidatePath: mockRevalidatePath,
	unstable_cache: (fn: any) => fn,
}));

vi.mock("@/lib/foundation/action", () => ({
	adminAction: (opts: unknown, handler: (ctx: any) => unknown) => {
		capturedAdminAction.calls.push([opts, handler]);
		mockAdminAction(opts, handler);
		return async (input?: unknown) => {
			const ctx = {
				session: { user: { id: 1, username: "admin", rank: 10 } },
				permissions: {},
				requestId: "req-1",
				ip: "127.0.0.1",
				...(input !== undefined ? { data: input } : {}),
			};
			return await handler(ctx);
		};
	},
	actionOk: (data?: unknown) => ({ ok: true, data: data ?? {} }),
}));

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { reload: mockReload },
}));

vi.mock("@/lib/services/habbo-furnidata-cache", () => ({
	clearOfficialHabboFurnidataCache: mockClearFurnidata,
}));

vi.mock("@/lib/services/habboassets", () => ({
	clearBadgeCache: mockClearBadge,
}));

import { WebsiteSetting } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import {
	createSetting,
	deleteSetting,
	saveManagedSettings,
	updateSetting,
} from "./admin-settings";

function form(data: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [key, value] of Object.entries(data)) fd.set(key, value);
	return fd;
}

beforeEach(() => {
	vi.clearAllMocks();
	fakeDbConfig.ops.length = 0;
	fakeDbConfig.fail = undefined;
	mockRequirePermissionRateLimited.mockResolvedValue({
		id: 1,
		rank: 7,
		username: "admin",
	});
});

describe("saveManagedSettings", () => {
	it("is wrapped with the SETTINGS_EDIT permission and rate limiting config", () => {
		expect(capturedAdminAction.calls).toHaveLength(1);
		expect(capturedAdminAction.calls[0][0]).toEqual(
			expect.objectContaining({
				permission: PERMS.SETTINGS_EDIT,
				rateLimitKey: "admin-settings-save",
				rateLimitMax: 30,
			}),
		);
	});

	it("saves only managed keys and revalidates admin routes", async () => {
		const result = await saveManagedSettings({
			settings: {
				cms_logo: "/logo.png",
				cms_favicon: "/favicon.svg",
				not_a_managed_key: "ignored",
			},
		});

		expect(fakeDbConfig.ops).toHaveLength(2);
		const inserts = fakeDbConfig.ops.filter((o: any) => o.kind === "insert");
		expect(inserts.map((o: any) => o.values.key).sort()).toEqual([
			"cms_favicon",
			"cms_logo",
		]);
		expect((inserts as any[])[0].onDuplicate).toBeDefined();
		expect(mockReload).toHaveBeenCalledTimes(1);
		expect(mockClearFurnidata).not.toHaveBeenCalled();
		expect(mockClearBadge).not.toHaveBeenCalled();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/settings");
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/catalog");
		expect(result).toEqual({ ok: true, data: { saved: 2 } });
	});

	it("normalizes the gamedata hotel value and busts gamedata caches", async () => {
		const result = await saveManagedSettings({
			settings: { habbo_gamedata_hotel: "  es " },
		});

		const op = fakeDbConfig.ops[0];
		expect(op.values).toMatchObject({
			key: "habbo_gamedata_hotel",
			value: "es",
		});
		expect(mockClearFurnidata).toHaveBeenCalledTimes(1);
		expect(mockClearBadge).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ ok: true, data: { saved: 1 } });
	});

	it("reports saved 0 for an empty settings object", async () => {
		const result = await saveManagedSettings({ settings: {} });
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockReload).toHaveBeenCalledTimes(1);
		expect(mockClearFurnidata).not.toHaveBeenCalled();
		expect(result).toEqual({ ok: true, data: { saved: 0 } });
	});
});

describe("updateSetting", () => {
	it("rejects when the caller lacks SETTINGS_EDIT", async () => {
		mockRequirePermissionRateLimited.mockRejectedValueOnce(new Error("denied"));
		await expect(updateSetting(form({ key: "a", value: "b" }))).rejects.toThrow(
			"denied",
		);
	});

	it("returns early for a blank key", async () => {
		await updateSetting(form({ key: "  ", value: "x" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockReload).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("upserts a plain setting and reloads without busting gamedata caches", async () => {
		await updateSetting(form({ key: "cms_logo", value: "/new-logo.png" }));

		expect(mockRequirePermissionRateLimited).toHaveBeenCalledWith(
			"admin.settings.edit",
		);
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("insert");
		expect(op.table).toBe(WebsiteSetting);
		expect(op.values).toEqual({ key: "cms_logo", value: "/new-logo.png" });
		expect(op.onDuplicate).toEqual({ value: "/new-logo.png" });
		expect(mockReload).toHaveBeenCalledTimes(1);
		expect(mockClearFurnidata).not.toHaveBeenCalled();
		expect(mockClearBadge).not.toHaveBeenCalled();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/settings");
	});

	it("normalizes and busts gamedata caches for the hotel setting", async () => {
		await updateSetting(form({ key: "habbo_gamedata_hotel", value: " FR " }));
		expect(fakeDbConfig.ops[0].values).toEqual({
			key: "habbo_gamedata_hotel",
			value: "fr",
		});
		expect(mockClearFurnidata).toHaveBeenCalledTimes(1);
		expect(mockClearBadge).toHaveBeenCalledTimes(1);
	});
});

describe("createSetting", () => {
	it("returns early for a blank key", async () => {
		await createSetting(form({ key: "", value: "x" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
	});

	it("creates a setting with a trimmed comment", async () => {
		await createSetting(
			form({ key: "custom_key", value: "v1", comment: "  My comment  " }),
		);
		expect(fakeDbConfig.ops[0].values).toEqual({
			key: "custom_key",
			value: "v1",
			comment: "My comment",
		});
		expect(mockReload).toHaveBeenCalledTimes(1);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/settings");
	});

	it("stores a null comment when blank", async () => {
		await createSetting(form({ key: "custom_key", value: "v1" }));
		expect(fakeDbConfig.ops[0].values.comment).toBeNull();
	});

	it("busts gamedata caches for the hotel setting", async () => {
		await createSetting(form({ key: "habbo_gamedata_hotel", value: "de" }));
		expect(fakeDbConfig.ops[0].values.value).toBe("de");
		expect(mockClearFurnidata).toHaveBeenCalledTimes(1);
		expect(mockClearBadge).toHaveBeenCalledTimes(1);
	});
});

describe("deleteSetting", () => {
	it("returns early for a blank key", async () => {
		await deleteSetting(form({ key: "" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockReload).not.toHaveBeenCalled();
	});

	it("deletes a plain setting and reloads", async () => {
		await deleteSetting(form({ key: "cms_logo" }));
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("delete");
		expect(op.table).toBe(WebsiteSetting);
		expect(op.where).toBeDefined();
		expect(mockReload).toHaveBeenCalledTimes(1);
		expect(mockClearFurnidata).not.toHaveBeenCalled();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/settings");
	});

	it("busts gamedata caches when deleting the hotel setting", async () => {
		await deleteSetting(form({ key: "habbo_gamedata_hotel" }));
		expect(mockClearFurnidata).toHaveBeenCalledTimes(1);
		expect(mockClearBadge).toHaveBeenCalledTimes(1);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/settings");
	});
});
