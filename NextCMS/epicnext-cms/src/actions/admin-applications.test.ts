// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	staff: { id: 9, rank: 7, username: "staff" },
	deleteWhere: vi.fn(async () => [{ affectedRows: 1 }]),
	logStaffActivity: vi.fn(async () => undefined),
	logServerError: vi.fn(),
	revalidatePath: vi.fn(),
	requirePermissionRateLimited: vi.fn(),
}));

vi.mock("@/lib/admin/guard", () => ({
	requirePermissionRateLimited: mocks.requirePermissionRateLimited,
}));
vi.mock("@/lib/permissions", () => ({
	PERMS: { USERS_EDIT: "admin.users.edit" },
}));
vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: mocks.logStaffActivity,
}));
vi.mock("@/lib/server-log", () => ({ logServerError: mocks.logServerError }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	return {
		...schema,
		db: {
			delete: vi.fn(() => ({ where: mocks.deleteWhere })),
		},
	};
});

import { PERMS } from "@/lib/permissions";
import { approveApplication, dismissApplication } from "./admin-applications";

function form(id: string) {
	const f = new FormData();
	f.set("id", id);
	return f;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requirePermissionRateLimited.mockResolvedValue(mocks.staff);
	mocks.deleteWhere.mockResolvedValue([{ affectedRows: 1 }]);
});

describe("dismissApplication", () => {
	it("deletes the application, logs activity and revalidates", async () => {
		await dismissApplication(form("42"));

		expect(mocks.requirePermissionRateLimited).toHaveBeenCalledWith(
			PERMS.USERS_EDIT,
		);
		expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
		expect(mocks.logStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				staffId: 9,
				action: "application_dismiss",
				description: "Dismissed staff application #42",
				targetType: "staff_application",
				targetId: 42,
			}),
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/applications");
	});

	it("returns early for a zero id", async () => {
		await dismissApplication(form("0"));

		expect(mocks.deleteWhere).not.toHaveBeenCalled();
		expect(mocks.logStaffActivity).not.toHaveBeenCalled();
	});

	it("returns early for a non-numeric id", async () => {
		await dismissApplication(form("abc"));

		expect(mocks.deleteWhere).not.toHaveBeenCalled();
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("swallows delete failures, still logs and revalidates", async () => {
		mocks.deleteWhere.mockRejectedValueOnce(new Error("db down"));

		await expect(dismissApplication(form("7"))).resolves.toBeUndefined();

		expect(mocks.logServerError).toHaveBeenCalledWith(
			"applications.delete_failed",
			expect.any(Error),
			{ id: "7" },
		);
		expect(mocks.logStaffActivity).toHaveBeenCalled();
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/applications");
	});

	it("propagates a permission denial without touching the db", async () => {
		mocks.requirePermissionRateLimited.mockRejectedValueOnce(
			new Error("redirect:/"),
		);

		await expect(dismissApplication(form("1"))).rejects.toThrow("redirect:/");
		expect(mocks.deleteWhere).not.toHaveBeenCalled();
	});
});

describe("approveApplication", () => {
	it("deletes the application and logs approval", async () => {
		await approveApplication(form("99"));

		expect(mocks.requirePermissionRateLimited).toHaveBeenCalledWith(
			PERMS.USERS_EDIT,
		);
		expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
		expect(mocks.logStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				staffId: 9,
				action: "application_approve",
				description: "Approved staff application #99",
				targetType: "staff_application",
				targetId: 99,
			}),
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/applications");
	});

	it("returns early for an invalid id", async () => {
		await approveApplication(form("0"));

		expect(mocks.deleteWhere).not.toHaveBeenCalled();
		expect(mocks.logStaffActivity).not.toHaveBeenCalled();
	});

	it("swallows delete failures and still logs the approval", async () => {
		mocks.deleteWhere.mockRejectedValueOnce(new Error("db down"));

		await expect(approveApplication(form("12"))).resolves.toBeUndefined();

		expect(mocks.logServerError).toHaveBeenCalledWith(
			"applications.delete_failed",
			expect.any(Error),
			{ id: "12" },
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/applications");
	});
});
