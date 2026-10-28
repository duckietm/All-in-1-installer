// @ts-nocheck
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeForm } from "@/test/fake-form";

const state = vi.hoisted(() => ({
	insertError: null as Error | null,
	updateError: null as Error | null,
	deleteError: null as Error | null,
	insertCalls: [] as { table: unknown; values: unknown }[],
	updateCalls: [] as { table: unknown; values: unknown; where: unknown }[],
	deleteCalls: [] as { table: unknown; where: unknown }[],
	nextId: 1,
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

const mockLogStaffActivity = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: mockLogStaffActivity,
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	return {
		...schema,
		db: {
			insert: (table: unknown) => ({
				values: (values: unknown) => {
					if (state.insertError) {
						const e = state.insertError;
						state.insertError = null;
						throw e;
					}
					state.insertCalls.push({ table, values });
					return [{ insertId: state.nextId++ }];
				},
			}),
			update: (table: unknown) => ({
				set: (values: unknown) => ({
					where: (where: unknown) => {
						if (state.updateError) {
							const e = state.updateError;
							state.updateError = null;
							throw e;
						}
						state.updateCalls.push({ table, values, where });
						return [{ affectedRows: 1 }];
					},
				}),
			}),
			delete: (table: unknown) => ({
				where: (where: unknown) => {
					if (state.deleteError) {
						const e = state.deleteError;
						state.deleteError = null;
						throw e;
					}
					state.deleteCalls.push({ table, where });
					return [{ affectedRows: 1 }];
				},
			}),
		},
	};
});

import { WebsiteWriteableBoxes } from "@/lib/db";
import {
	createBox,
	deleteBox,
	toggleBox,
	updateBox,
} from "./admin-writeable-boxes";

const staff = { id: 5, rank: 4, username: "editor" };

beforeEach(() => {
	vi.clearAllMocks();
	mockRequirePermission.mockResolvedValue(staff as never);
	state.insertError = null;
	state.updateError = null;
	state.deleteError = null;
	state.insertCalls = [];
	state.updateCalls = [];
	state.deleteCalls = [];
	state.nextId = 1;
	vi.mocked(mockLogStaffActivity).mockResolvedValue(undefined);
});

describe("createBox", () => {
	it("rejects callers without PAGES_EDIT", async () => {
		mockRequirePermission.mockRejectedValueOnce(new Error("denied"));
		await expect(
			createBox(fakeForm({ title: "Hi" }) as FormData),
		).rejects.toThrow("denied");
		expect(state.insertCalls).toHaveLength(0);
	});

	it("returns early when the title is empty", async () => {
		await expect(createBox(fakeForm({}) as FormData)).resolves.toBeUndefined();
		expect(state.insertCalls).toHaveLength(0);
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("inserts a box, logs activity and revalidates", async () => {
		await createBox(
			fakeForm({
				title: "  Welcome  ",
				icon: " star ",
				content: "Body",
				position: "3.9",
				isActive: "1",
			}) as FormData,
		);

		expect(state.insertCalls).toHaveLength(1);
		expect(state.insertCalls[0].table).toBe(WebsiteWriteableBoxes);
		const values = state.insertCalls[0].values as Record<string, unknown>;
		expect(values.title).toBe("Welcome");
		expect(values.icon).toBe("star");
		expect(values.content).toBe("Body");
		expect(values.position).toBe(3);
		expect(values.isActive).toBe(true);
		expect(values.createdAt).toBeInstanceOf(Date);
		expect(values.updatedAt).toBeInstanceOf(Date);
		expect(mockLogStaffActivity).toHaveBeenCalledWith({
			staffId: 5,
			action: "writeable_box_create",
			description: 'Created writeable box "Welcome" (#1)',
			targetType: "writeable_box",
			targetId: 1,
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/writeable-boxes");
		expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
	});

	it("parses position defensively and treats missing icon/isActive sensibly", async () => {
		for (const [pos, expected] of [
			["", 0],
			["abc", 0],
			["-5", 0],
			["2", 2],
		] as const) {
			state.nextId = 1;
			await createBox(
				fakeForm({
					title: "T",
					position: pos,
					isActive: "0",
				}) as FormData,
			);
			const lastInsert = state.insertCalls.at(-1);
			expect(lastInsert).toBeDefined();
			const vals = lastInsert?.values as Record<string, unknown>;
			expect(vals.position).toBe(expected);
			expect(vals.isActive).toBe(false);
			expect(vals.icon).toBeNull();
		}
	});

	it("swallows a failed insert without revalidating", async () => {
		state.insertError = new Error("db down");
		await expect(
			createBox(fakeForm({ title: "New" }) as FormData),
		).resolves.toBeUndefined();
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});
});

describe("updateBox", () => {
	it("returns early for a blank/invalid id", async () => {
		await updateBox(fakeForm({ id: "", title: "T" }) as FormData);
		await updateBox(fakeForm({ id: "abc", title: "T" }) as FormData);
		expect(state.updateCalls).toHaveLength(0);
	});

	it("returns early when the title is blank", async () => {
		await updateBox(fakeForm({ id: "3", title: "  " }) as FormData);
		expect(state.updateCalls).toHaveLength(0);
	});

	it("updates the box and logs activity", async () => {
		await updateBox(
			fakeForm({
				id: "7",
				title: "Patched",
				icon: "",
				content: "C",
				position: "1",
				isActive: "1",
			}) as FormData,
		);

		expect(state.updateCalls).toHaveLength(1);
		expect(state.updateCalls[0].table).toBe(WebsiteWriteableBoxes);
		expect(state.updateCalls[0].where).toEqual(
			eq(WebsiteWriteableBoxes.id, BigInt(7)),
		);
		const values = state.updateCalls[0].values as Record<string, unknown>;
		expect(values.title).toBe("Patched");
		expect(values.icon).toBeNull();
		expect(values.isActive).toBe(true);
		expect(values.updatedAt).toBeInstanceOf(Date);
		expect(mockLogStaffActivity).toHaveBeenCalledWith({
			staffId: 5,
			action: "writeable_box_update",
			description: 'Updated writeable box #7 ("Patched")',
			targetType: "writeable_box",
			targetId: 7,
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
	});

	it("swallows a failed update", async () => {
		state.updateError = new Error("db down");
		await expect(
			updateBox(fakeForm({ id: "1", title: "T" }) as FormData),
		).resolves.toBeUndefined();
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});
});

describe("deleteBox", () => {
	it("returns early for a blank id", async () => {
		await deleteBox(fakeForm({ id: "" }) as FormData);
		expect(state.deleteCalls).toHaveLength(0);
	});

	it("deletes the box and logs activity", async () => {
		await deleteBox(fakeForm({ id: "9" }) as FormData);
		expect(state.deleteCalls).toHaveLength(1);
		expect(state.deleteCalls[0].table).toBe(WebsiteWriteableBoxes);
		expect(state.deleteCalls[0].where).toEqual(
			eq(WebsiteWriteableBoxes.id, BigInt(9)),
		);
		expect(mockLogStaffActivity).toHaveBeenCalledWith({
			staffId: 5,
			action: "writeable_box_delete",
			description: "Deleted writeable box #9",
			targetType: "writeable_box",
			targetId: 9,
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/writeable-boxes");
	});

	it("swallows a failed delete", async () => {
		state.deleteError = new Error("db down");
		await expect(
			deleteBox(fakeForm({ id: "1" }) as FormData),
		).resolves.toBeUndefined();
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});
});

describe("toggleBox", () => {
	it("returns early for a missing id", async () => {
		await toggleBox(fakeForm({}) as FormData);
		expect(state.updateCalls).toHaveLength(0);
	});

	it("activates when next is 1", async () => {
		await toggleBox(fakeForm({ id: "2", next: "1" }) as FormData);
		expect(state.updateCalls).toHaveLength(1);
		expect(
			(state.updateCalls[0].values as Record<string, unknown>).isActive,
		).toBe(true);
		expect(mockLogStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "writeable_box_toggle",
				description: "Activated writeable box #2",
			}),
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
	});

	it("hides when next is anything but 1", async () => {
		await toggleBox(fakeForm({ id: "2", next: "0" }) as FormData);
		expect(
			(state.updateCalls[0].values as Record<string, unknown>).isActive,
		).toBe(false);
		expect(mockLogStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				description: "Hid writeable box #2",
			}),
		);
	});

	it("swallows a failed toggle", async () => {
		state.updateError = new Error("db down");
		await expect(
			toggleBox(fakeForm({ id: "2", next: "1" }) as FormData),
		).resolves.toBeUndefined();
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});
});
