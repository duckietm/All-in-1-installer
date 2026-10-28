// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	revision: "0",
	values: new Map<string, unknown>(),
	get: vi.fn(),
	set: vi.fn(),
	publish: vi.fn(),
	status: "ready",
	// Set by the subscriber mock so a test can simulate another process
	// publishing a new revision.
	deliver: null as ((channel: string, message: string) => void) | null,
}));

vi.mock("@/lib/redis", () => ({
	redis: {
		get: (key: string) => state.get(key),
		set: (key: string, value: string) => state.set(key, value),
		publish: (channel: string, message: string) =>
			state.publish(channel, message),
		get status() {
			return state.status;
		},
		duplicate: () => ({
			on: (event: string, handler: (...args: unknown[]) => void) => {
				if (event === "message") state.deliver = handler;
			},
			subscribe: async () => 1,
		}),
	},
}));
vi.mock("@/lib/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/lib/cache", () => ({
	cached: async (key: string, _ttl: number, query: () => Promise<unknown>) => {
		if (state.values.has(key)) return state.values.get(key);
		const result = await query();
		state.values.set(key, result);
		return result;
	},
}));

import {
	cacheNews,
	invalidateNewsCache,
	refreshNewsCacheForDelivery,
} from "./news-cache";

beforeEach(() => {
	state.values.clear();
	state.revision = "0";
	state.status = "ready";
	state.get.mockReset().mockImplementation(async () => state.revision);
	state.set
		.mockReset()
		.mockImplementation(async (_key: string, value: string) => {
			state.revision = value;
		});
	state.publish.mockReset().mockResolvedValue(1);
});

it("invalidates a previously cached public list", async () => {
	const query = vi
		.fn()
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce(["new article"]);
	expect(await cacheNews("list", 60000, query)).toEqual([]);
	await invalidateNewsCache();
	expect(await cacheNews("list", 60000, query)).toEqual(["new article"]);
});

it("reads the revision at most once for a burst of reads", async () => {
	// The revision used to be fetched from Redis on every single call, which put
	// a round-trip in front of the very fast path the cache exists to provide.
	const before = state.get.mock.calls.length;
	await cacheNews("burst-a", 60000, async () => ["a"]);
	await cacheNews("burst-b", 60000, async () => ["b"]);
	await cacheNews("burst-c", 60000, async () => ["c"]);
	expect(state.get.mock.calls.length - before).toBeLessThanOrEqual(1);
});

it("picks up a revision published by another process", async () => {
	expect(await cacheNews("list", 60000, async () => ["old"])).toEqual(["old"]);

	// Another process rotates the revision; the local copy must be dropped so the
	// next read re-reads it instead of serving the previous namespace.
	state.revision = "rev-from-worker";
	state.deliver?.("cache:news-revision", "rev-from-worker");

	expect(await cacheNews("list", 60000, async () => ["new"])).toEqual(["new"]);
});

it("tells other processes when the revision rotates", async () => {
	await invalidateNewsCache();
	expect(state.publish).toHaveBeenCalledWith(
		"cache:news-revision",
		expect.any(String),
	);
});

it("does not let a stale in-flight read replace a newer revision", async () => {
	let finish!: (value: string[]) => void;
	const old = cacheNews(
		"list",
		60000,
		() =>
			new Promise<string[]>((resolve) => {
				finish = resolve;
			}),
	);
	await vi.waitFor(() => expect(finish).toBeDefined());
	await invalidateNewsCache();
	expect(await cacheNews("list", 60000, async () => ["new"])).toEqual(["new"]);
	finish([]);
	await old;
	expect(await cacheNews("list", 60000, async () => ["wrong"])).toEqual([
		"new",
	]);
});

it("reads fresh data when Redis is unavailable", async () => {
	state.get.mockRejectedValue(Error("offline"));
	expect(await cacheNews("list", 60000, async () => ["fresh"])).toEqual([
		"fresh",
	]);
});

it("still caches in-process when Redis is unavailable", async () => {
	// A Redis outage must not turn every public news read into a database query.
	state.status = "end";
	const query = vi.fn(async () => ["fresh"]);
	expect(await cacheNews("list", 60000, query)).toEqual(["fresh"]);
	expect(await cacheNews("list", 60000, query)).toEqual(["fresh"]);
	expect(query).toHaveBeenCalledTimes(1);
});

it("keeps failed durable cache invalidations retryable", async () => {
	state.set.mockRejectedValue(Error("offline"));
	await expect(refreshNewsCacheForDelivery()).rejects.toThrow("offline");
});

it("does not acknowledge an ended Redis connection as refreshed", async () => {
	state.status = "end";
	await expect(refreshNewsCacheForDelivery()).rejects.toThrow();
});
