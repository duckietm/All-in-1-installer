// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	requirePermission: vi.fn(async () => ({
		id: 100,
		rank: 7,
		username: "staff",
	})),
	revalidatePath: vi.fn(),
	del: vi.fn(async () => [{ affectedRows: 1 }]),
	update: vi.fn(async () => [{ affectedRows: 1 }]),
}));

vi.mock("@/lib/admin/guard", () => ({
	requirePermission: state.requirePermission,
}));
vi.mock("@/lib/permissions", () => ({
	PERMS: { CATALOG_EDIT: "admin.catalog.edit" },
}));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb(() => []);
	return {
		...schema,
		db: {
			...fake,
			delete: (table: unknown) => ({
				where: (where: unknown) => state.del(table, where),
			}),
			update: (table: unknown) => ({
				set: (values: unknown) => ({
					where: (where: unknown) => state.update(table, values, where),
				}),
			}),
		},
	};
});

import { Soundtracks } from "@/lib/db";
import { deleteSoundtrack, updateSoundtrack } from "./soundtracks";

describe("soundtrack actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.requirePermission.mockResolvedValue({
			id: 100,
			rank: 7,
			username: "staff",
		});
		state.del.mockResolvedValue([{ affectedRows: 1 }]);
		state.update.mockResolvedValue([{ affectedRows: 1 }]);
	});

	it("deletes a soundtrack with the catalog edit permission", async () => {
		await deleteSoundtrack({ id: 12 });
		expect(state.requirePermission).toHaveBeenCalledWith("admin.catalog.edit");
		expect(state.del).toHaveBeenCalledWith(Soundtracks, expect.anything());
		expect(state.revalidatePath).toHaveBeenCalledWith("/admin/sounds");
	});

	it("denies deletion without the catalog edit permission", async () => {
		state.requirePermission.mockRejectedValueOnce(new Error("forbidden"));
		await expect(deleteSoundtrack({ id: 12 })).rejects.toThrow("forbidden");
		expect(state.del).not.toHaveBeenCalled();
	});

	it("updates a soundtrack with the catalog edit permission", async () => {
		await updateSoundtrack({
			id: 12,
			name: "Spring",
			author: "Vivaldi",
			track: "data:wav",
			length: 90,
		});
		expect(state.requirePermission).toHaveBeenCalledWith("admin.catalog.edit");
		expect(state.update).toHaveBeenCalledWith(
			Soundtracks,
			{ name: "Spring", author: "Vivaldi", track: "data:wav", length: 90 },
			expect.anything(),
		);
		expect(state.revalidatePath).toHaveBeenCalledWith("/admin/sounds");
	});

	it("denies updates without the catalog edit permission", async () => {
		state.requirePermission.mockRejectedValueOnce(new Error("forbidden"));
		await expect(
			updateSoundtrack({
				id: 12,
				name: "x",
				author: "y",
				track: "z",
				length: 1,
			}),
		).rejects.toThrow("forbidden");
		expect(state.update).not.toHaveBeenCalled();
	});
});
