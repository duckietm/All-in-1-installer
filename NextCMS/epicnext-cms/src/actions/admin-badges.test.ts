// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	existingRows: [] as unknown[],
	maxRows: [] as unknown[],
	insertValues: vi.fn(async () => [{}]),
	fail: false,
	giveBadge: vi.fn(async () => undefined),
	requirePermission: vi.fn(),
	tryGuardRank: vi.fn(),
	revalidatePath: vi.fn(),
}));

vi.mock("@/lib/admin/guard", () => ({
	requirePermission: state.requirePermission,
}));
vi.mock("@/lib/admin/rank-guard", () => ({
	tryGuardRank: state.tryGuardRank,
}));
vi.mock("@/lib/permissions", () => ({
	PERMS: { CATALOG_EDIT: "admin.catalog.edit" },
}));
vi.mock("@/lib/services/rcon", () => ({
	rcon: { giveBadge: state.giveBadge },
}));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb((_table, projection) => {
		if (state.fail) throw new Error("db down");
		return "maxSlot" in projection ? state.maxRows : state.existingRows;
	});
	return {
		...schema,
		db: {
			...fake,
			insert: vi.fn(() => ({ values: state.insertValues })),
		},
	};
});

import { PERMS } from "@/lib/permissions";
import { giveBadge } from "./admin-badges";

function form(userId: string, code: string) {
	const f = new FormData();
	f.set("userId", userId);
	f.set("code", code);
	return f;
}

beforeEach(() => {
	vi.clearAllMocks();
	state.existingRows = [];
	state.maxRows = [];
	state.fail = false;
	state.insertValues.mockResolvedValue([{}]);
	state.giveBadge.mockResolvedValue(undefined);
	state.requirePermission.mockResolvedValue({ id: 1, rank: 7, username: "a" });
	state.tryGuardRank.mockResolvedValue({
		ok: true,
		target: { username: "u", rank: 1, mail: null },
	});
});

describe("giveBadge", () => {
	it("grants via rcon and persists at the next free slot", async () => {
		state.maxRows = [{ maxSlot: 5 }];

		await giveBadge(form("3", "ACH_Test"));

		expect(state.requirePermission).toHaveBeenCalledWith(PERMS.CATALOG_EDIT);
		expect(state.tryGuardRank).toHaveBeenCalledWith(3, 7);
		expect(state.giveBadge).toHaveBeenCalledWith(3, "ACH_Test");
		expect(state.insertValues).toHaveBeenCalledWith({
			userId: 3,
			slotId: 6,
			badgeCode: "ACH_Test",
		});
		expect(state.revalidatePath).toHaveBeenCalledWith("/admin/badges");
	});

	it("uses slot 1 when the user has no badges yet", async () => {
		state.maxRows = [];

		await giveBadge(form("3", "NEW"));

		expect(state.insertValues).toHaveBeenCalledWith({
			userId: 3,
			slotId: 1,
			badgeCode: "NEW",
		});
	});

	it("treats a null max slot as zero", async () => {
		state.maxRows = [{ maxSlot: null }];

		await giveBadge(form("3", "NEW"));

		expect(state.insertValues).toHaveBeenCalledWith({
			userId: 3,
			slotId: 1,
			badgeCode: "NEW",
		});
	});

	it("does not persist a duplicate badge and skips revalidation", async () => {
		state.existingRows = [{ id: 10 }];

		await giveBadge(form("4", "DUP"));

		expect(state.giveBadge).toHaveBeenCalledWith(4, "DUP");
		expect(state.insertValues).not.toHaveBeenCalled();
		expect(state.revalidatePath).not.toHaveBeenCalled();
	});

	it("skips a user at or above the actor rank", async () => {
		state.tryGuardRank.mockResolvedValueOnce({ ok: false, reason: "rank" });

		await giveBadge(form("4", "DUP"));

		expect(state.giveBadge).not.toHaveBeenCalled();
		expect(state.insertValues).not.toHaveBeenCalled();
		expect(state.revalidatePath).not.toHaveBeenCalled();
	});

	it("skips an unknown user", async () => {
		state.tryGuardRank.mockResolvedValueOnce({
			ok: false,
			reason: "not_found",
		});

		await giveBadge(form("404", "DUP"));

		expect(state.giveBadge).not.toHaveBeenCalled();
		expect(state.insertValues).not.toHaveBeenCalled();
	});

	it("returns early for a non-positive user id", async () => {
		await giveBadge(form("0", "X"));

		expect(state.tryGuardRank).not.toHaveBeenCalled();
		expect(state.giveBadge).not.toHaveBeenCalled();
		expect(state.insertValues).not.toHaveBeenCalled();
		expect(state.revalidatePath).not.toHaveBeenCalled();
	});

	it("returns early for an empty code", async () => {
		await giveBadge(form("5", "   "));

		expect(state.giveBadge).not.toHaveBeenCalled();
	});

	it("returns early when the code field is absent", async () => {
		const f = new FormData();
		f.set("userId", "5");

		await giveBadge(f);

		expect(state.giveBadge).not.toHaveBeenCalled();
	});

	it("normalises and truncates the badge code to 32 characters", async () => {
		const longCode = "a".repeat(40);

		await giveBadge(form("5", `  ${longCode}  `));

		expect(state.giveBadge).toHaveBeenCalledWith(5, "a".repeat(32));
	});

	it("caps bulk user and code lists", async () => {
		const users = Array.from({ length: 250 }, (_, i) => i + 1).join(",");
		const codes = Array.from({ length: 250 }, (_, i) => `C${i}`).join(",");

		await giveBadge(form(users, codes));

		// 100 users x 100 codes = 10k pairs, capped to MAX_PAIRS (500).
		const calls = state.insertValues.mock.calls.length;
		expect(calls).toBeLessThanOrEqual(500);
	});

	it("throws when persistence fails instead of swallowing it", async () => {
		state.insertValues.mockRejectedValueOnce(new Error("db down"));

		await expect(giveBadge(form("6", "BEST"))).rejects.toThrow(
			"Failed to persist",
		);

		expect(state.giveBadge).toHaveBeenCalledWith(6, "BEST");
		expect(state.revalidatePath).not.toHaveBeenCalled();
	});

	it("throws when the select fails instead of reporting a false success", async () => {
		state.fail = true;

		await expect(giveBadge(form("6", "BEST"))).rejects.toThrow(
			"Failed to persist",
		);

		expect(state.revalidatePath).not.toHaveBeenCalled();
	});

	it("propagates a permission denial", async () => {
		state.requirePermission.mockRejectedValueOnce(new Error("redirect:/admin"));

		await expect(giveBadge(form("1", "X"))).rejects.toThrow("redirect:/admin");
		expect(state.giveBadge).not.toHaveBeenCalled();
	});
});
