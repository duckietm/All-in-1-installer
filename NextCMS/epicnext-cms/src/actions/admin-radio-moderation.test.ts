// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeDbConfig = vi.hoisted(() => ({
	ops: [] as any[],
	fail: undefined as any,
}));

const mockRequirePermission = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());
const mockLogStaffActivity = vi.hoisted(() => vi.fn());

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

vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: mockLogStaffActivity,
}));

import { RadioShouts } from "@/lib/db";
import { deleteShout } from "./admin-radio-moderation";

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
		id: 55,
		rank: 7,
		username: "mod",
	});
});

describe("deleteShout", () => {
	it("deletes a shout and logs staff activity", async () => {
		await deleteShout(form({ id: "12" }));

		expect(mockRequirePermission).toHaveBeenCalledWith("admin.radio.edit");
		expect(fakeDbConfig.ops).toHaveLength(1);
		const op = fakeDbConfig.ops[0];
		expect(op.kind).toBe("delete");
		expect(op.table).toBe(RadioShouts);
		expect(op.where).toBeDefined();
		expect(mockLogStaffActivity).toHaveBeenCalledWith({
			staffId: 55,
			action: "radio.shout.delete",
			description: "Deleted radio shout #12",
			targetType: "radio_shout",
			targetId: 12,
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/moderation");
	});

	it("rejects when the caller lacks RADIO_EDIT", async () => {
		mockRequirePermission.mockRejectedValueOnce(new Error("denied"));
		await expect(deleteShout(form({ id: "1" }))).rejects.toThrow("denied");
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("returns early for an invalid id", async () => {
		await deleteShout(form({ id: "abc" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("returns early for a zero id", async () => {
		await deleteShout(form({ id: "0" }));
		expect(fakeDbConfig.ops).toHaveLength(0);
	});

	it("swallows DB failures but still revalidates", async () => {
		fakeDbConfig.fail = (kind: string) => kind === "delete";
		await deleteShout(form({ id: "3" }));
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/radio/moderation");
	});
});
