// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	deleted: [] as string[],
	published: [] as string[],
	failDelete: false,
	status: "ready",
	localKeys: new Set<string>(),
}));

vi.mock("@/lib/redis", () => ({
	redis: {
		get status() {
			return state.status;
		},
		del: async (key: string) => {
			if (state.failDelete) throw Error("redis write failed");
			state.deleted.push(key);
			return 1;
		},
		publish: async (channel: string, key: string) => {
			state.published.push(`${channel}|${key}`);
			return 1;
		},
		duplicate: () => ({
			on: () => {},
			subscribe: async () => 1,
		}),
	},
}));
vi.mock("@/lib/logger", () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/cache-invalidation", () => ({
	publishCacheInvalidation: async (key: string) => {
		state.published.push(`broadcast|${key}`);
	},
	onCacheInvalidated: () => {},
}));

import { invalidateKey } from "./cached-db";

beforeEach(() => {
	state.deleted = [];
	state.published = [];
	state.failDelete = false;
	state.status = "ready";
});

it("clears memory, Redis and the other instances", async () => {
	expect(await invalidateKey("home:news")).toBe(1);
	expect(state.deleted).toEqual(["home:news"]);
	expect(state.published).toEqual(["broadcast|home:news"]);
});

it("still tells the other instances when the Redis delete fails", async () => {
	// Returning early here would leave every other process serving the old value
	// until its own TTL ran out, while this one already had the new value.
	state.failDelete = true;
	expect(await invalidateKey("home:news")).toBe(0);
	expect(state.published).toEqual(["broadcast|home:news"]);
});

it("still tells the other instances when Redis is gone", async () => {
	state.status = "end";
	expect(await invalidateKey("home:news")).toBe(0);
	expect(state.published).toEqual(["broadcast|home:news"]);
});
