// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	fail: false,
	friends: [] as { id: number; username: string; online: string }[],
}));
vi.mock("@/lib/hotel-name", () => ({ resolveHotelName: async () => "Hotel" }));
vi.mock("./site-settings", () => ({
	siteSettings: {
		get: async (_key: string, fallback: string) => fallback,
		getMany: async () => ({}),
	},
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	return {
		...schema,
		db: {
			select: (fields: Record<string, unknown>) => {
				let rows: unknown[] = [];
				const chain = {
					from: (table: unknown) => {
						if (table === schema.MessengerFriendships)
							rows =
								"value" in fields
									? [{ value: state.friends.length }]
									: state.friends;
						return chain;
					},
					where: () => chain,
					innerJoin: () => chain,
					orderBy: () => chain,
					limit: () => chain,
					catch: (fallback: () => unknown) =>
						Promise.resolve(state.fail ? fallback() : rows),
					// biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are intentionally awaitable.
					then: (resolve: (value: unknown[]) => unknown) =>
						Promise.resolve(rows).then(resolve),
				};
				return chain;
			},
		},
	};
});

import { loadUserDashboard } from "./user-dashboard";

describe("dashboard friendships", () => {
	beforeEach(() => {
		state.friends = [];
		state.fail = false;
	});
	it("marks unavailable sections instead of presenting them as empty data", async () => {
		state.fail = true;
		const data = await loadUserDashboard(1);
		expect(data).toMatchObject({
			friendsUnavailable: true,
			badgesUnavailable: true,
			userSettingsUnavailable: true,
			referralsRows: null,
		});
	});
	it("counts each friend once when both directional rows are returned", async () => {
		const wait = { id: 2, username: "wait", online: "1" };
		const other = { id: 3, username: "YouKnowMe", online: "1" };
		state.friends = [wait, other, { ...wait }, { ...other }];
		const data = await loadUserDashboard(1);
		expect(data.friends.map((friend) => friend.id)).toEqual([2, 3]);
		expect(data.friendCountRows).toEqual([{ value: 2 }]);
	});
	it("preserves single-direction and offline friendships", async () => {
		state.friends = [
			{ id: 2, username: "wait", online: "1" },
			{ id: 3, username: "offline", online: "0" },
		];
		const data = await loadUserDashboard(1);
		expect(data.friends).toEqual(state.friends);
		expect(data.friendCountRows).toEqual([{ value: 2 }]);
	});
	it("excludes self friendships", async () => {
		state.friends = [{ id: 1, username: "me", online: "1" }];
		const data = await loadUserDashboard(1);
		expect(data.friends).toEqual([]);
		expect(data.friendCountRows).toEqual([{ value: 0 }]);
	});
	it("returns zero for an empty friends list", async () => {
		const data = await loadUserDashboard(1);
		expect(data.friends).toEqual([]);
		expect(data.friendCountRows).toEqual([{ value: 0 }]);
	});
});
