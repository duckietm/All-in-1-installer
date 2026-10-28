// @ts-nocheck
import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requirePermission } from "@/lib/admin/guard";
import { tryRemoveLocalPhotoFile } from "@/lib/admin/photo-files";
import { logStaffActivity } from "@/lib/services/staff-activity";
import { fakeForm } from "@/test/fake-form";
import { deletePhoto } from "./admin-photos";

const { select, deleteFn, limit, whereDelete } = vi.hoisted(() => {
	const limit = vi.fn();
	const whereSelect = vi.fn(() => ({ limit }));
	const from = vi.fn(() => ({ where: whereSelect }));
	const select = vi.fn(() => ({ from }));
	const whereDelete = vi.fn();
	const deleteFn = vi.fn(() => ({ where: whereDelete }));
	return { select, deleteFn, limit, whereDelete, whereSelect, from };
});

vi.mock("@/lib/admin/guard", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ PERMS: { PAGES_EDIT: "pages.edit" } }));
vi.mock("@/lib/admin/photo-files", () => ({
	tryRemoveLocalPhotoFile: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
	db: {
		select: (...args) => select(...args),
		delete: (...args) => deleteFn(...args),
	},
	CameraWeb: { id: "id", url: "url" },
}));

beforeEach(() => {
	vi.clearAllMocks();
	limit.mockResolvedValue([{ id: 42, url: "/uploads/cam/42.png" }]);
	whereDelete.mockResolvedValue(undefined);
	vi.mocked(requirePermission).mockResolvedValue({
		id: 1,
		rank: 7,
		username: "admin",
	});
});

describe("deletePhoto", () => {
	it("deletes a photo and revalidates", async () => {
		await deletePhoto(fakeForm({ id: "42" }));
		expect(select).toHaveBeenCalled();
		expect(deleteFn).toHaveBeenCalled();
		expect(tryRemoveLocalPhotoFile).toHaveBeenCalledWith("/uploads/cam/42.png");
		expect(logStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "photo_delete",
				targetId: 42,
			}),
		);
		expect(revalidatePath).toHaveBeenCalledWith("/admin/photos");
		expect(revalidatePath).toHaveBeenCalledWith("/photos");
	});

	it("returns early when id is not positive", async () => {
		await deletePhoto(fakeForm({ id: "0" }));
		expect(select).not.toHaveBeenCalled();
		expect(deleteFn).not.toHaveBeenCalled();
	});
});
