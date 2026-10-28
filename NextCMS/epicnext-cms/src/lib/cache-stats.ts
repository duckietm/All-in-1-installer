import "server-only";

import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

/**
 * Hit/miss accounting for the in-process/Redis cache.
 *
 * Without this there is no way to tell a healthy cache from one that is silently
 * serving nothing: a wrong Redis URL, a full memory budget or a dead origin all
 * look identical from the outside — everything just gets slower. Counters are
 * aggregated in-process and flushed to Redis on a timer, so the numbers survive
 * a restart and can be read from any instance.
 */

const REDIS_KEY = "cms:cache-stats:v1:shared";
const FLUSH_INTERVAL_MS = 30_000;
const WINDOW_MS = 5 * 60 * 1000;

export interface CacheKeyStats {
	hits: number;
	misses: number;
	/** Served past the TTL from the grace window while refreshing behind it. */
	stale: number;
	/** Origin calls that threw. */
	errors: number;
	/** Evictions from the in-process budget, i.e. a key we had to recompute. */
	evictions: number;
}

export type CacheOutcome = "hit" | "miss" | "stale" | "error" | "evicted";

const OUTCOME_FIELD = {
	hit: "hits",
	miss: "misses",
	stale: "stale",
	error: "errors",
	evicted: "evictions",
} as const satisfies Record<CacheOutcome, keyof CacheKeyStats>;

const globalForStats = globalThis as typeof globalThis & {
	cacheStats?: Map<string, CacheKeyStats>;
	cacheStatsTimer?: ReturnType<typeof setInterval>;
};

// Per key, not global: one hot key thrashing must be visible on its own.
const stats = globalForStats.cacheStats ?? new Map<string, CacheKeyStats>();
globalForStats.cacheStats = stats;

// Bound the key space: a high-cardinality cache must not leak one entry per key.
const MAX_TRACKED_KEYS = 500;

function empty(): CacheKeyStats {
	return { hits: 0, misses: 0, stale: 0, errors: 0, evictions: 0 };
}

function slot(key: string): CacheKeyStats {
	let entry = stats.get(key);
	if (entry) return entry;
	if (stats.size >= MAX_TRACKED_KEYS) {
		// Map order is insertion order and record() re-inserts, so the first key
		// is the least recently accounted one.
		const oldest = stats.keys().next().value;
		if (oldest !== undefined) stats.delete(oldest);
	}
	entry = empty();
	stats.set(key, entry);
	return entry;
}

/** Record the outcome of one `cached()` call. Never throws, never awaits. */
export function recordCacheOutcome(key: string, outcome: CacheOutcome): void {
	const entry = slot(key);
	entry[OUTCOME_FIELD[outcome]]++;
	stats.delete(key);
	stats.set(key, entry);
	schedule();
}

function snapshot(): Record<string, CacheKeyStats> {
	return Object.fromEntries(
		[...stats.entries()].map(([key, value]) => [key, { ...value }]),
	);
}

async function flush(): Promise<void> {
	if (process.env.NODE_ENV === "test" || redis?.status !== "ready") return;
	try {
		await redis.setex(
			REDIS_KEY,
			Math.ceil(WINDOW_MS / 1000),
			JSON.stringify(snapshot()),
		);
	} catch {
		// Metrics must never interfere with serving.
	}
}

function schedule(): void {
	if (globalForStats.cacheStatsTimer) return;
	if (process.env.NEXT_PHASE === "phase-production-build") return;
	if (process.env.NODE_ENV === "test") return;
	globalForStats.cacheStatsTimer = setInterval(() => {
		void flush();
	}, FLUSH_INTERVAL_MS);
	// Never hold the process open just to report counters.
	globalForStats.cacheStatsTimer.unref?.();
}

export interface CacheStatsReport {
	/** True when the numbers came from Redis, i.e. cover every instance. */
	shared: boolean;
	keys: Record<string, CacheKeyStats>;
	totals: CacheKeyStats & { hitRatio: number; keys: number };
	/** False when Redis was unreachable, which silently disables shared caching. */
	redisAvailable: boolean;
}

export async function readCacheStats(): Promise<CacheStatsReport> {
	let keys: Record<string, CacheKeyStats> = snapshot();
	let shared = false;
	if (redis?.status === "ready") {
		try {
			const raw = await redis.get(REDIS_KEY);
			if (raw) {
				keys = JSON.parse(raw) as Record<string, CacheKeyStats>;
				shared = true;
			}
		} catch (error) {
			if (process.env.NODE_ENV !== "test") {
				logger.warn("[cache] stats unavailable", { error: String(error) });
			}
		}
	}

	const totals = empty();
	for (const value of Object.values(keys)) {
		totals.hits += value.hits ?? 0;
		totals.misses += value.misses ?? 0;
		totals.stale += value.stale ?? 0;
		totals.errors += value.errors ?? 0;
		totals.evictions += value.evictions ?? 0;
	}
	const decided = totals.hits + totals.misses + totals.stale;
	return {
		shared,
		keys,
		totals: {
			...totals,
			// A stale serve is a cache hit: the origin was not called for it.
			hitRatio: decided === 0 ? 0 : (totals.hits + totals.stale) / decided,
			keys: Object.keys(keys).length,
		},
		redisAvailable: Boolean(redis && redis.status === "ready"),
	};
}
