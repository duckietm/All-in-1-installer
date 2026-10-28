// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	// These stand in for the real cache, which runs the query on a miss, so a
	// failing database really does propagate into the warm-up.
	cached: vi.fn(
		async (_key: string, _ttl: number, query: () => Promise<unknown>) =>
			query(),
	),
	redisCache: vi.fn(
		async (_key: string, _ttl: number, query: () => Promise<unknown>) =>
			query(),
	),
	cacheNews: vi.fn(
		async (_key: string, _ttl: number, query: () => Promise<unknown>) =>
			query(),
	),
	warn: vi.fn(),
	// Set by a test to make every origin query reject.
	failEverything: false,
}));

vi.mock("@/lib/logger", () => ({
	logger: { warn: state.warn, error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/cache", () => ({ cached: state.cached }));
vi.mock("@/lib/redis-cache", () => ({
	redisCache: state.redisCache,
	apiCacheKey: (name: string) => `api:${name}`,
}));
vi.mock("@/lib/services/news-cache", () => ({ cacheNews: state.cacheNews }));
vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { get: vi.fn(async () => "7") },
}));
vi.mock("@/lib/db", () => {
	// A chainable stand-in for a drizzle query that always resolves to a row.
	const row = { total: 1, username: "a", look: "l", rank: 7, motto: "m" };
	// Chainable and awaitable at once, the way a drizzle query builder is.
	const chain: any = new Proxy(() => {}, {
		get: (_target, prop) => {
			if (prop === Symbol.toStringTag) return "Query";
			if (prop === "then")
				return (resolve: any, reject: any) =>
					(state.failEverything
						? Promise.reject(Error("database is down"))
						: Promise.resolve([row])
					).then(resolve, reject);
			return () => chain;
		},
	});
	return {
		db: { select: () => chain },
		User: { online: "online", username: "username", rank: "rank" },
		Rooms: {},
		CameraWeb: {},
		WebsiteTeams: { id: "id", hiddenRank: "hiddenRank" },
	};
});

import { warmPublicCaches } from "./cache-warmup";

beforeEach(() => {
	state.failEverything = false;
	for (const mock of [
		state.cached,
		state.redisCache,
		state.cacheNews,
		state.warn,
	])
		mock.mockClear();
});

it("primes the keys the public pages actually read", async () => {
	await warmPublicCaches();
	const keys = state.cached.mock.calls.map(([key]) => key);
	expect(keys).toContain("online_count");
	expect(keys).toContain("total_users");
	expect(keys).toContain("total_rooms");
	expect(keys).toContain("total_photos");
	expect(state.redisCache.mock.calls.map(([key]) => key)).toEqual(
		expect.arrayContaining(["api:staff", "api:teams"]),
	);
	expect(state.cacheNews).toHaveBeenCalled();
});

it("gives every primed key a stale window", async () => {
	// Warming without a grace window would leave the first visitor after a deploy
	// to still pay for a miss, which is the thing being fixed.
	await warmPublicCaches();
	for (const call of [
		...state.cached.mock.calls,
		...state.redisCache.mock.calls,
	])
		expect(call[3]?.staleMs).toBeGreaterThan(0);
});

it("survives a database that is completely unavailable", async () => {
	// register() calls this without awaiting: it must never reject, or an
	// unhandled rejection would take the process down on every boot.
	state.failEverything = true;
	await expect(warmPublicCaches()).resolves.toBeUndefined();
	expect(state.warn).toHaveBeenCalled();
});
