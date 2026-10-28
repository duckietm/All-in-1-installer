// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeDbConfig = vi.hoisted(() => ({
	ops: [] as any[],
	fail: undefined as any,
}));

const mockRequirePermission = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());
const mockReload = vi.hoisted(() => vi.fn());
const mockLogStaffActivity = vi.hoisted(() => vi.fn());
const mockRedirect = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeActionDb } = await import("@/test/fake-db-actions");
	return { ...schema, db: createFakeActionDb(fakeDbConfig) };
});

vi.mock("@/lib/admin/guard", () => ({
	requirePermission: mockRequirePermission,
}));

vi.mock("@/lib/permissions", () => ({
	PERMS: { RADIO_EDIT: "admin.radio.edit" },
}));

vi.mock("next/cache", () => ({
	revalidatePath: mockRevalidatePath,
	unstable_cache: (fn: any) => fn,
}));

vi.mock("next/navigation", () => ({
	redirect: mockRedirect,
}));

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { reload: mockReload },
}));

vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: mockLogStaffActivity,
}));

import { WebsiteSetting } from "@/lib/db";
import { savePoints } from "./admin-radio-points";

function form(data: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [key, value] of Object.entries(data)) fd.set(key, value);
	return fd;
}

beforeEach(() => {
	vi.clearAllMocks();
	fakeDbConfig.ops.length = 0;
	fakeDbConfig.fail = undefined;
	mockRequirePermission.mockResolvedValue({
		id: 42,
		rank: 7,
		username: "admin",
	});
});

describe("savePoints", () => {
	it("saves all five point settings with normalized values", async () => {
		await savePoints(
			form({
				radio_points_enabled: "on",
				radio_points_per_minute: "5.9",
				radio_points_currency: "duckets",
				radio_points_max_per_day: "100",
				radio_points_min_listeners: "2",
			}),
		);

		expect(mockRequirePermission).toHaveBeenCalledWith("admin.radio.edit");
		const inserts = fakeDbConfig.ops.filter((o: any) => o.kind === "insert");
		expect(inserts).toHaveLength(5);
		for (const op of inserts) {
			expect(op.table).toBe(WebsiteSetting);
			expect(op.values.comment).toBe("Radio points");
			expect(op.onDuplicate).toBeDefined();
		}
		const byKey = Object.fromEntries(
			inserts.map((op: any) => [op.values.key, op.values.value]),
		);
		expect(byKey).toEqual({
			radio_points_enabled: "1",
			radio_points_per_minute: "5",
			radio_points_currency: "duckets",
			radio_points_max_per_day: "100",
			radio_points_min_listeners: "2",
		});
		expect(mockReload).toHaveBeenCalledTimes(1);
		expect(mockLogStaffActivity).toHaveBeenCalledWith({
			staffId: 42,
			action: "radio_points_update",
			description:
				"Updated radio listener-points settings (enabled=1, 5/min duckets)",
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/points");
		expect(mockRedirect).toHaveBeenCalledWith("/admin/radio/points?saved=1");
	});

	it("falls back to credits and clamps invalid integers to 0", async () => {
		await savePoints(
			form({
				radio_points_enabled: "0",
				radio_points_per_minute: "-3",
				radio_points_currency: "brainz",
				radio_points_max_per_day: "abc",
				radio_points_min_listeners: "",
			}),
		);

		const inserts = fakeDbConfig.ops.filter((o: any) => o.kind === "insert");
		const byKey = Object.fromEntries(
			inserts.map((op: any) => [op.values.key, op.values.value]),
		);
		expect(byKey).toEqual({
			radio_points_enabled: "0",
			radio_points_per_minute: "0",
			radio_points_currency: "credits",
			radio_points_max_per_day: "0",
			radio_points_min_listeners: "0",
		});
		expect(mockLogStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				description:
					"Updated radio listener-points settings (enabled=0, 0/min credits)",
			}),
		);
	});

	it("handles an empty form with defaults", async () => {
		await savePoints(new FormData());
		const inserts = fakeDbConfig.ops.filter((o: any) => o.kind === "insert");
		expect(inserts).toHaveLength(5);
		const byKey = Object.fromEntries(
			inserts.map((op: any) => [op.values.key, op.values.value]),
		);
		expect(byKey).toEqual({
			radio_points_enabled: "0",
			radio_points_per_minute: "0",
			radio_points_currency: "credits",
			radio_points_max_per_day: "0",
			radio_points_min_listeners: "0",
		});
	});

	it("rejects when the caller lacks RADIO_EDIT", async () => {
		mockRequirePermission.mockRejectedValueOnce(new Error("denied"));
		await expect(savePoints(new FormData())).rejects.toThrow("denied");
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockRedirect).not.toHaveBeenCalled();
	});

	it("fails soft on DB errors but still revalidates and redirects", async () => {
		fakeDbConfig.fail = (kind: string) =>
			kind === "insert" ? "db down" : false;
		await savePoints(
			form({ radio_points_enabled: "on", radio_points_currency: "diamonds" }),
		);
		expect(mockReload).not.toHaveBeenCalled();
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/points");
		expect(mockRedirect).toHaveBeenCalledWith("/admin/radio/points?saved=1");
	});
});
