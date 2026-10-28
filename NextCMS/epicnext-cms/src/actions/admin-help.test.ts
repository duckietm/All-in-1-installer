// @ts-nocheck
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requirePermission } from "@/lib/admin/guard";
import { fakeForm } from "@/test/fake-form";
import {
	createHelpQuestion,
	deleteHelpQuestion,
	updateHelpQuestion,
} from "./admin-help";

const { insertValues, updateWhere, deleteWhere } = vi.hoisted(() => {
	const insertValues = vi.fn().mockResolvedValue([{ insertId: 5 }]);
	const updateWhere = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
	const deleteWhere = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
	return { insertValues, updateWhere, deleteWhere };
});

vi.mock("@/lib/admin/guard", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ PERMS: { PAGES_EDIT: "pages.edit" } }));
vi.mock("@/lib/db", () => ({
	db: {
		insert: vi.fn(() => ({ values: insertValues })),
		update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
		delete: vi.fn(() => ({ where: deleteWhere })),
	},
	WebsiteHelpCenterCategories: { id: "id" },
}));
vi.mock("@/lib/services/staff-activity", () => ({ logStaffActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const staff = { id: 1, rank: 7, username: "admin" };
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(requirePermission).mockResolvedValue(staff as never);
	insertValues.mockResolvedValue([{ insertId: 5 }]);
	updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
	deleteWhere.mockResolvedValue([{ affectedRows: 1 }]);
});

describe("createHelpQuestion", () => {
	it("creates a help question and redirects", async () => {
		await createHelpQuestion(
			fakeForm({
				name: "FAQ",
				content: "<p>Answer</p>",
			}) as FormData,
		);
		expect(insertValues).toHaveBeenCalled();
		expect(redirect).toHaveBeenCalledWith("/admin/help-questions");
	});
});

describe("updateHelpQuestion", () => {
	it("updates and redirects", async () => {
		await updateHelpQuestion(
			fakeForm({
				id: "42",
				name: "Updated",
				content: "New",
			}) as FormData,
		);
		expect(updateWhere).toHaveBeenCalled();
		expect(redirect).toHaveBeenCalledWith("/admin/help-questions");
	});
});

describe("deleteHelpQuestion", () => {
	it("deletes and redirects", async () => {
		await deleteHelpQuestion(fakeForm({ id: "42" }) as FormData);
		expect(deleteWhere).toHaveBeenCalled();
		expect(redirect).toHaveBeenCalledWith("/admin/help-questions");
	});
});
