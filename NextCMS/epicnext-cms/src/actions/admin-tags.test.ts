// @ts-nocheck
import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requirePermission } from "@/lib/admin/guard";
import { logStaffActivity } from "@/lib/services/staff-activity";
import { fakeForm } from "@/test/fake-form";
import { createTag, deleteTag, updateTag } from "./admin-tags";

const { insertValues, updateWhere, deleteWhere, transaction } = vi.hoisted(
	() => {
		const insertValues = vi.fn().mockResolvedValue([{ insertId: 1 }]);
		const updateWhere = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
		const deleteWhere = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
		const transaction = vi.fn(async (fn) =>
			fn({
				delete: vi.fn(() => ({ where: deleteWhere })),
			}),
		);
		return { insertValues, updateWhere, deleteWhere, transaction };
	},
);

vi.mock("@/lib/admin/guard", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ PERMS: { PAGES_EDIT: "pages.edit" } }));
vi.mock("@/lib/db", () => ({
	db: {
		insert: vi.fn(() => ({ values: insertValues })),
		update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
		delete: vi.fn(() => ({ where: deleteWhere })),
		transaction,
	},
	Tags: { id: "id", name: "name", backgroundColor: "backgroundColor" },
	Taggables: { tagId: "tagId" },
}));
vi.mock("@/lib/services/staff-activity", () => ({ logStaffActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const staff = { id: 1, rank: 7, username: "admin" };
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(requirePermission).mockResolvedValue(staff as never);
	insertValues.mockResolvedValue([{ insertId: 1 }]);
	updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
	deleteWhere.mockResolvedValue([{ affectedRows: 1 }]);
	transaction.mockImplementation(async (fn) =>
		fn({
			delete: vi.fn(() => ({ where: deleteWhere })),
		}),
	);
});

describe("createTag", () => {
	it("creates a tag and revalidates", async () => {
		await createTag(
			fakeForm({
				name: "News",
				backgroundColor: "#ff0000",
			}) as FormData,
		);

		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ name: "News" }),
		);
		expect(logStaffActivity).toHaveBeenCalled();
		expect(revalidatePath).toHaveBeenCalledWith("/admin/tags");
	});

	it("returns early when name is empty", async () => {
		await createTag(fakeForm({ name: "" }) as FormData);
		expect(insertValues).not.toHaveBeenCalled();
	});

	it("uses default color when not provided", async () => {
		await createTag(fakeForm({ name: "Test" }) as FormData);

		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ backgroundColor: "#888888" }),
		);
	});

	it("handles db error gracefully", async () => {
		insertValues.mockRejectedValue(new Error("DB error"));

		await expect(
			createTag(fakeForm({ name: "News" }) as FormData),
		).resolves.toBeUndefined();
		expect(revalidatePath).toHaveBeenCalledWith("/admin/tags");
	});
});

describe("updateTag", () => {
	it("updates a tag and revalidates", async () => {
		await updateTag(
			fakeForm({
				id: "42",
				name: "Updated",
				backgroundColor: "#00ff00",
			}) as FormData,
		);

		expect(updateWhere).toHaveBeenCalled();
		expect(logStaffActivity).toHaveBeenCalled();
		expect(revalidatePath).toHaveBeenCalledWith("/admin/tags");
	});

	it("returns early when id is invalid", async () => {
		await updateTag(fakeForm({ id: "", name: "Test" }) as FormData);
		expect(updateWhere).not.toHaveBeenCalled();
	});

	it("returns early when name is empty after update", async () => {
		await updateTag(fakeForm({ id: "42", name: "" }) as FormData);
		expect(updateWhere).not.toHaveBeenCalled();
	});
});

describe("deleteTag", () => {
	it("deletes a tag and its taggables", async () => {
		await deleteTag(fakeForm({ id: "42" }) as FormData);

		expect(transaction).toHaveBeenCalled();
		expect(deleteWhere).toHaveBeenCalled();
		expect(logStaffActivity).toHaveBeenCalled();
		expect(revalidatePath).toHaveBeenCalledWith("/admin/tags");
	});

	it("returns early when id is invalid", async () => {
		await deleteTag(fakeForm({ id: "" }) as FormData);
		expect(transaction).not.toHaveBeenCalled();
	});
});
