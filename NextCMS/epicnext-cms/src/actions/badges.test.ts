// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	badges: [] as { badgeName: string; badgeDescription: string }[],
	upserts: [] as { table: unknown; values: unknown; conflict: unknown }[],
}));

const mockRequirePermission = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/guard", () => ({
	requirePermission: mockRequirePermission,
}));

vi.mock("@/lib/permissions", async () => {
	const { PERMS } = await import("@/lib/permission-slugs");
	return { PERMS };
});

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), handlers: {} }));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
	revalidatePath: mockRevalidatePath,
	unstable_cache: (fn: unknown) => fn,
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	return {
		...schema,
		db: {
			...createFakeDb((table) =>
				table === schema.WebsiteBadges ? state.badges : [],
			),
			insert: (table: unknown) => ({
				values: (values: unknown) => ({
					onDuplicateKeyUpdate: (conflict: unknown) => {
						state.upserts.push({ table, values, conflict });
						return [{ insertId: 1 }];
					},
				}),
			}),
		},
	};
});

import { WebsiteBadges } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { getBadgeData, updateBadge } from "./badges";

const staff = { id: 1, rank: 7, username: "admin" };

beforeEach(() => {
	vi.clearAllMocks();
	mockRequirePermission.mockResolvedValue(staff as never);
	state.badges = [];
	state.upserts = [];
});

describe("getBadgeData", () => {
	it("rejects callers without CATALOG_EDIT", async () => {
		mockRequirePermission.mockRejectedValueOnce(new Error("denied"));
		await expect(getBadgeData({ code: "B1" })).rejects.toThrow("denied");
	});

	it("returns a null payload when the badge does not exist", async () => {
		state.badges = [];
		await expect(getBadgeData({ code: "MISSING" })).resolves.toEqual({
			ok: false,
			data: null,
		});
	});

	it("returns name and description for an existing badge", async () => {
		state.badges = [{ badgeName: "B1", badgeDescription: "desc" }];
		await expect(getBadgeData({ code: "B1" })).resolves.toEqual({
			ok: true,
			data: { name: "B1", desc: "desc" },
		});
		expect(mockRequirePermission).toHaveBeenCalledWith(PERMS.CATALOG_EDIT);
	});
});

describe("updateBadge", () => {
	it("inserts or updates the badge and revalidates", async () => {
		const before = Date.now();
		await updateBadge({ code: "B2", name: "N", desc: "D" });

		expect(state.upserts).toHaveLength(1);
		expect(state.upserts[0].table).toBe(WebsiteBadges);
		const values = state.upserts[0].values as {
			badgeKey: string;
			badgeName: string;
			badgeDescription: string;
			createdAt: Date;
			updatedAt: Date;
		};
		expect(values.badgeKey).toBe("B2");
		expect(values.badgeName).toBe("N");
		expect(values.badgeDescription).toBe("D");
		expect(values.createdAt.getTime()).toBeGreaterThanOrEqual(before);
		expect((state.upserts[0].conflict as { set: unknown }).set).toMatchObject({
			badgeName: "N",
			badgeDescription: "D",
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/import/badges");
		expect(mockRequirePermission).toHaveBeenCalledWith(PERMS.CATALOG_EDIT);
	});
});
