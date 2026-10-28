// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	fail: false,
	rows: [] as unknown[][],
	query: "",
	params: [] as unknown[],
}));
vi.mock("@/lib/db", async () => {
	const { drizzle } = await import("drizzle-orm/mysql-proxy");
	return {
		db: drizzle(async (query, params) => {
			state.query = query;
			state.params = params;
			if (state.fail) throw new Error("offline");
			return { rows: state.rows };
		}),
	};
});

import { loadProfilePrivacy } from "./profile-privacy";

describe("profile privacy", () => {
	beforeEach(() => {
		state.fail = false;
		state.rows = [];
	});
	it("defaults the wallet to private while retaining public social sections", async () => {
		expect(await loadProfilePrivacy(42)).toEqual({
			unavailable: false,
			values: {
				wallet: false,
				online: true,
				friends: true,
				photos: true,
				registered: true,
			},
		});
		expect(state.params).toEqual([42, 1]);
	});
	it("fails closed if saved visibility cannot be read", async () => {
		state.fail = true;
		expect(await loadProfilePrivacy(42)).toEqual({
			unavailable: true,
			values: {
				wallet: false,
				online: false,
				friends: false,
				photos: false,
				registered: false,
			},
		});
	});
	it("reads the specific profile owners explicit visibility choices", async () => {
		state.rows = [[42, 1, 0, 0, 0, 0]];
		const result = await loadProfilePrivacy(42);
		expect(result.values).toMatchObject({
			wallet: true,
			online: false,
			friends: false,
			photos: false,
			registered: false,
		});
	});
});
