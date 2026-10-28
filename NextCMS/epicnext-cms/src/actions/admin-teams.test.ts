// @ts-nocheck
import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requirePermission } from "@/lib/admin/guard";
import { fakeForm } from "@/test/fake-form";
import { createTeam, deleteTeam } from "./admin-teams";

const { insertValues, deleteWhere } = vi.hoisted(() => {
	const insertValues = vi.fn().mockResolvedValue([{ insertId: 1 }]);
	const deleteWhere = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
	return { insertValues, deleteWhere };
});

vi.mock("@/lib/admin/guard", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ PERMS: { USERS_EDIT: "users.edit" } }));
vi.mock("@/lib/db", () => ({
	db: {
		insert: vi.fn(() => ({ values: insertValues })),
		delete: vi.fn(() => ({ where: deleteWhere })),
	},
	WebsiteTeams: { id: "id" },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const staff = { id: 1, rank: 7, username: "admin" };
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(requirePermission).mockResolvedValue(staff as never);
	insertValues.mockResolvedValue([{ insertId: 1 }]);
	deleteWhere.mockResolvedValue([{ affectedRows: 1 }]);
});

describe("createTeam", () => {
	it("creates a team entry", async () => {
		await createTeam(fakeForm({ rankName: "Moderator" }) as FormData);
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ rankName: "Moderator" }),
		);
		expect(revalidatePath).toHaveBeenCalledWith("/admin/teams");
	});

	it("returns early when rankName is empty", async () => {
		await createTeam(fakeForm({ rankName: "" }) as FormData);
		expect(insertValues).not.toHaveBeenCalled();
	});
});

describe("deleteTeam", () => {
	it("deletes a team entry", async () => {
		await deleteTeam(fakeForm({ id: "42" }) as FormData);
		expect(deleteWhere).toHaveBeenCalled();
		expect(revalidatePath).toHaveBeenCalledWith("/admin/teams");
	});
});
