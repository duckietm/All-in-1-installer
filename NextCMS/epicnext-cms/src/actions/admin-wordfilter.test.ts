// @ts-nocheck
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	insertError: null as Error | null,
	insertCalls: [] as { table: unknown; values: unknown }[],
	deleteCalls: [] as { table: unknown; where: unknown }[],
	nextId: 1,
}));

const mockRequirePermission = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/guard", () => ({
	requirePermission: mockRequirePermission,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), handlers: {} }));

vi.mock("@/lib/permissions", async () => {
	const { PERMS } = await import("@/lib/permission-slugs");
	return { PERMS };
});

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
	revalidatePath: mockRevalidatePath,
	unstable_cache: (fn: unknown) => fn,
}));

const mockReloadWordFilter = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/moderation", () => ({
	reloadWordFilter: mockReloadWordFilter,
}));

const mockUpdateWordFilter = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/rcon", () => ({
	rcon: { updateWordFilter: mockUpdateWordFilter },
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
			delete: (table: unknown) => ({
				where: (where: unknown) => {
					state.deleteCalls.push({ table, where });
					return [{ affectedRows: 1 }];
				},
			}),
		},
	};
});

import { WebsiteWordfilter } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { addWord, deleteWord } from "./admin-wordfilter";

const staff = { id: 1, rank: 7, username: "admin" };

beforeEach(() => {
	vi.clearAllMocks();
	mockRequirePermission.mockResolvedValue(staff as never);
	state.insertError = null;
	state.insertCalls = [];
	state.deleteCalls = [];
	state.nextId = 1;
	mockRevalidatePath.mockClear();
	mockReloadWordFilter.mockClear();
	mockUpdateWordFilter.mockClear();
});

describe("addWord", () => {
	it("rejects when the caller lacks WORDFILTER_EDIT permission", async () => {
		mockRequirePermission.mockRejectedValueOnce(new Error("denied"));
		await expect(addWord({ word: "bad" })).rejects.toThrow("denied");
		expect(mockRequirePermission).toHaveBeenCalledWith(PERMS.WORDFILTER_EDIT);
		expect(state.insertCalls).toHaveLength(0);
	});

	it("errors when the word is empty (or missing)", async () => {
		await expect(addWord({ word: "" })).resolves.toEqual({
			ok: false,
			error: "Word is required",
		});
		await expect(addWord({} as { word: string })).resolves.toEqual({
			ok: false,
			error: "Word is required",
		});
		expect(state.insertCalls).toHaveLength(0);
	});

	it("normalizes, trims and truncates the word to 255 chars and inserts it", async () => {
		const longWord = `${"a".repeat(300)}  `;
		const result = await addWord({ word: `  ${longWord} ` });

		expect(result).toEqual({
			ok: true,
			data: { id: "1" },
		});
		expect(state.insertCalls).toHaveLength(1);
		expect(state.insertCalls[0].table).toBe(WebsiteWordfilter);
		expect(state.insertCalls[0].values).toEqual({
			word: "a".repeat(255),
		});
		expect(mockReloadWordFilter).toHaveBeenCalledTimes(1);
		expect(mockUpdateWordFilter).toHaveBeenCalledTimes(1);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/wordfilter");
	});

	it("maps a duplicate-key insert error to a friendly message", async () => {
		state.insertError = new Error("ER_DUP_ENTRY");
		const result = await addWord({ word: "dupe" });
		expect(result).toEqual({
			ok: false,
			error: "Could not add word (it may already exist)",
		});
		expect(mockReloadWordFilter).not.toHaveBeenCalled();
		expect(mockUpdateWordFilter).not.toHaveBeenCalled();
	});
});

describe("deleteWord", () => {
	it("errors when the id is missing", async () => {
		await expect(deleteWord({ id: "" })).resolves.toEqual({
			ok: false,
			error: "Missing word id",
		});
		expect(state.deleteCalls).toHaveLength(0);
	});

	it("deletes by id, reloads the filter and revalidates", async () => {
		const result = await deleteWord({ id: "42" });
		expect(result).toEqual({ ok: true, data: {} });
		expect(state.deleteCalls).toHaveLength(1);
		expect(state.deleteCalls[0].table).toBe(WebsiteWordfilter);
		expect(state.deleteCalls[0].where).toEqual(
			eq(WebsiteWordfilter.id, BigInt(42)),
		);
		expect(mockReloadWordFilter).toHaveBeenCalledTimes(1);
		expect(mockUpdateWordFilter).toHaveBeenCalledTimes(1);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/wordfilter");
	});

	it("maps a non-numeric id or a failed delete to the generic error", async () => {
		await expect(deleteWord({ id: "not-a-number" })).resolves.toEqual({
			ok: false,
			error: "Could not remove word",
		});
	});
});
