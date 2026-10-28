// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	users: [] as Array<{ username: string; rank: number; mail: string | null }>,
	highestRank: 8,
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb((_table, projection) =>
		"username" in projection ? state.users : [],
	);
	return { ...schema, db: fake };
});

vi.mock("@/lib/permissions", () => ({
	getHighestRank: vi.fn(async () => state.highestRank),
}));

vi.mock("@/lib/safe-action-shared", () => ({
	ActionError: class ActionError extends Error {},
}));

import { getHighestRank } from "@/lib/permissions";
import { guardRank, tryGuardRank } from "./rank-guard";

beforeEach(() => {
	vi.clearAllMocks();
	state.users = [{ username: "victim", rank: 5, mail: "v@x.nl" }];
	state.highestRank = 8;
});

describe("tryGuardRank", () => {
	it("allows an actor at a strictly higher rank", async () => {
		const result = await tryGuardRank(1, 7);
		expect(result).toEqual({ ok: true, target: state.users[0] });
	});

	it("blocks an actor at the same rank", async () => {
		state.users = [{ username: "victim", rank: 7, mail: null }];
		const result = await tryGuardRank(1, 7);
		expect(result).toEqual({ ok: false, reason: "rank" });
	});

	it("blocks an actor at a lower rank", async () => {
		const result = await tryGuardRank(1, 3);
		expect(result).toEqual({ ok: false, reason: "rank" });
	});

	it("lets the dynamic super admin act on anyone", async () => {
		state.users = [{ username: "victim", rank: 8, mail: "v@x.nl" }];
		state.highestRank = 8;
		const result = await tryGuardRank(1, 8);
		expect(result).toEqual({
			ok: true,
			target: { username: "victim", rank: 8, mail: "v@x.nl" },
		});
		expect(await getHighestRank()).toBe(8);
	});

	it("reports a missing target as not_found", async () => {
		state.users = [];
		const result = await tryGuardRank(999, 7);
		expect(result).toEqual({ ok: false, reason: "not_found" });
	});
});

describe("guardRank", () => {
	it("throws a readable ActionError for a target at equal or higher rank", async () => {
		state.users = [{ username: "victim", rank: 7, mail: null }];
		await expect(guardRank(1, 7)).rejects.toThrow(
			"Cannot modify user with equal or higher rank",
		);
	});

	it("throws a readable ActionError for a missing target", async () => {
		state.users = [];
		await expect(guardRank(999, 7)).rejects.toThrow("User not found");
	});
});
