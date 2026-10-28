// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	status: "ready",
	get: vi.fn(),
	setex: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({
	redis: {
		get: (key: string) => state.get(key),
		setex: (key: string, ttl: number, value: string) =>
			state.setex(key, ttl, value),
		get status() {
			return state.status;
		},
	},
}));
vi.mock("@/lib/logger", () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { readCacheStats, recordCacheOutcome } from "./cache-stats";

beforeEach(() => {
	// The map is process-global on purpose; tests get a clean one.
	globalThis.cacheStats?.clear();
	state.status = "ready";
	state.get.mockReset().mockResolvedValue(null);
	state.setex.mockReset().mockResolvedValue("OK");
});

it("counts outcomes per key", async () => {
	recordCacheOutcome("online_count", "hit");
	recordCacheOutcome("online_count", "hit");
	recordCacheOutcome("online_count", "miss");
	recordCacheOutcome("online_count", "stale");
	recordCacheOutcome("api_staff", "error");
	recordCacheOutcome("api_staff", "evicted");

	const report = await readCacheStats();
	expect(report.keys.online_count).toEqual({
		hits: 2,
		misses: 1,
		stale: 1,
		errors: 0,
		evictions: 0,
	});
	expect(report.keys.api_staff.errors).toBe(1);
	expect(report.keys.api_staff.evictions).toBe(1);
	expect(report.totals.keys).toBe(2);
});

it("counts a stale serve as a hit, since the origin was not called", async () => {
	recordCacheOutcome("k", "hit");
	recordCacheOutcome("k", "stale");
	recordCacheOutcome("k", "stale");
	const { totals } = await readCacheStats();
	// 1 real hit + 2 stale serves, none of which reached the database.
	expect(totals.hits).toBe(1);
	expect(totals.stale).toBe(2);
	expect(totals.hitRatio).toBe(1);
});

it("keeps the tracked key space bounded", async () => {
	for (let i = 0; i < 600; i++) recordCacheOutcome(`key-${i}`, "hit");
	const report = await readCacheStats();
	expect(report.totals.keys).toBeLessThanOrEqual(500);
});

it("reports Redis as unavailable when it is down, and stays usable", async () => {
	state.status = "end";
	recordCacheOutcome("online_count", "hit");
	const report = await readCacheStats();
	expect(report.redisAvailable).toBe(false);
	expect(report.shared).toBe(false);
	expect(report.keys.online_count.hits).toBe(1);
});

it("prefers the shared snapshot from Redis when one exists", async () => {
	recordCacheOutcome("local_only", "hit");
	state.get.mockResolvedValue(
		JSON.stringify({ shared_key: { hits: 9, misses: 1 } }),
	);
	const report = await readCacheStats();
	expect(report.shared).toBe(true);
	expect(report.keys.shared_key.hits).toBe(9);
	expect(report.totals.hitRatio).toBe(0.9);
});

it("survives an unreadable shared snapshot", async () => {
	recordCacheOutcome("local_only", "hit");
	state.get.mockRejectedValue(Error("offline"));
	const report = await readCacheStats();
	expect(report.shared).toBe(false);
	expect(report.redisAvailable).toBe(true);
	expect(report.keys.local_only.hits).toBe(1);
});
