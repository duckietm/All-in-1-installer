// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requirePermission: vi.fn(),
	keyRows: [] as unknown[],
	insertValues: vi.fn(async () => [{ insertId: 21 }]),
	updateSet: vi.fn(),
	updateWhere: vi.fn(async () => [{ affectedRows: 1 }]),
	deleteWhere: vi.fn(async () => [{ affectedRows: 1 }]),
	logStaffActivity: vi.fn(async () => undefined),
	revalidatePath: vi.fn(),
	redirect: vi.fn(),
}));

vi.mock("@/lib/admin/guard", () => ({
	requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/permissions", () => ({
	PERMS: { RADIO_EDIT: "admin.radio.edit" },
}));
vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: mocks.logStaffActivity,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb(() => mocks.keyRows);
	return {
		...schema,
		db: {
			...fake,
			insert: vi.fn(() => ({ values: mocks.insertValues })),
			update: vi.fn(() => ({ set: mocks.updateSet })),
			delete: vi.fn(() => ({ where: mocks.deleteWhere })),
		},
	};
});

import { PERMS } from "@/lib/permissions";
import {
	createApiKey,
	deleteApiKey,
	toggleApiKey,
} from "./admin-radio-api-keys";

function form(data: Record<string, string>) {
	const f = new FormData();
	for (const [k, v] of Object.entries(data)) f.set(k, v);
	return f;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requirePermission.mockResolvedValue({ id: 4, rank: 7, username: "a" });
	mocks.keyRows = [];
	mocks.insertValues.mockResolvedValue([{ insertId: 21 }]);
	mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
	mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
	mocks.deleteWhere.mockResolvedValue([{ affectedRows: 1 }]);
	mocks.logStaffActivity.mockResolvedValue(undefined);
});

describe("createApiKey", () => {
	it("mints a server-side key and redirects on success", async () => {
		await createApiKey(
			form({
				name: "  Bridge  ",
				allowedIps: " 1.2.3.4 ",
				rateLimit: "120",
			}),
		);

		expect(mocks.requirePermission).toHaveBeenCalledWith(PERMS.RADIO_EDIT);
		const values = (
			mocks.insertValues.mock.calls[0] as unknown as [Record<string, unknown>]
		)[0];
		expect(values.name).toBe("Bridge");
		expect(values.allowedIps).toBe("1.2.3.4");
		expect(values.rateLimit).toBe(120);
		expect(values.isActive).toBe(true);
		expect(values.key).toMatch(/^[0-9a-f]{48}$/);
		expect(mocks.logStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "radio_api_key_create",
				targetType: "radio_api_key",
				targetId: 21,
			}),
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/radio/api-keys");
		expect(mocks.redirect).toHaveBeenCalledWith(
			"/admin/radio/api-keys?created=1",
		);
	});

	it("defaults the rate limit and stores null when allowed IPs is blank", async () => {
		await createApiKey(form({ name: "Bot" }));

		const values = (
			mocks.insertValues.mock.calls[0] as unknown as [Record<string, unknown>]
		)[0];
		expect(values.rateLimit).toBe(300);
		expect(values.allowedIps).toBeNull();
	});

	it("falls back to the default for a negative or invalid rate limit", async () => {
		await createApiKey(form({ name: "A", rateLimit: "-5" }));
		await createApiKey(form({ name: "B", rateLimit: "abc" }));
		await createApiKey(form({ name: "C", rateLimit: "12.9" }));

		const rates = mocks.insertValues.mock.calls.map(
			(call) => (call as unknown as [Record<string, unknown>])[0].rateLimit,
		);
		expect(rates).toEqual([300, 300, 12]);
	});

	it("returns early when the name is blank", async () => {
		await createApiKey(form({ name: "   " }));

		expect(mocks.insertValues).not.toHaveBeenCalled();
		expect(mocks.redirect).not.toHaveBeenCalled();
	});

	it("fails soft when the insert throws", async () => {
		mocks.insertValues.mockRejectedValueOnce(new Error("duplicate"));

		await expect(createApiKey(form({ name: "Dup" }))).resolves.toBeUndefined();

		expect(mocks.logStaffActivity).not.toHaveBeenCalled();
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
		expect(mocks.redirect).not.toHaveBeenCalled();
	});
});

describe("toggleApiKey", () => {
	it("deactivates an active key", async () => {
		mocks.keyRows = [{ name: "Bridge", isActive: true }];

		await toggleApiKey(form({ id: "7" }));

		expect(mocks.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ isActive: false, updatedAt: expect.any(Date) }),
		);
		expect(mocks.logStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "radio_api_key_toggle",
				description: 'Deactivated radio API key "Bridge" (#7)',
				targetId: 7,
			}),
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/radio/api-keys");
	});

	it("activates an inactive key", async () => {
		mocks.keyRows = [{ name: "Bridge", isActive: false }];

		await toggleApiKey(form({ id: "7" }));

		expect(mocks.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ isActive: true }),
		);
		expect(mocks.logStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				description: 'Activated radio API key "Bridge" (#7)',
			}),
		);
	});

	it("returns early for a blank or invalid id", async () => {
		await toggleApiKey(form({ id: "" }));
		await toggleApiKey(form({ id: "not-a-bigint" }));

		expect(mocks.updateSet).not.toHaveBeenCalled();
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("does nothing when the key does not exist", async () => {
		mocks.keyRows = [];

		await toggleApiKey(form({ id: "7" }));

		expect(mocks.updateSet).not.toHaveBeenCalled();
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("fails soft when the update throws", async () => {
		mocks.keyRows = [{ name: "Bridge", isActive: true }];
		mocks.updateWhere.mockRejectedValueOnce(new Error("db down"));

		await expect(toggleApiKey(form({ id: "7" }))).resolves.toBeUndefined();

		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});
});

describe("deleteApiKey", () => {
	it("deletes the key and logs activity", async () => {
		await deleteApiKey(form({ id: "9" }));

		expect(mocks.requirePermission).toHaveBeenCalledWith(PERMS.RADIO_EDIT);
		expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
		expect(mocks.logStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "radio_api_key_delete",
				description: "Deleted radio API key #9",
				targetId: 9,
			}),
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/radio/api-keys");
	});

	it("returns early for an invalid id", async () => {
		await deleteApiKey(form({ id: "" }));

		expect(mocks.deleteWhere).not.toHaveBeenCalled();
	});

	it("fails soft when the delete throws", async () => {
		mocks.deleteWhere.mockRejectedValueOnce(new Error("db down"));

		await expect(deleteApiKey(form({ id: "9" }))).resolves.toBeUndefined();

		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("propagates a permission denial", async () => {
		mocks.requirePermission.mockRejectedValueOnce(new Error("redirect:/admin"));

		await expect(deleteApiKey(form({ id: "1" }))).rejects.toThrow(
			"redirect:/admin",
		);
		expect(mocks.deleteWhere).not.toHaveBeenCalled();
	});
});
