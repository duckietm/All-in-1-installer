import "server-only";

import { onCacheInvalidated } from "@/lib/cache-invalidation";
import { recordCacheOutcome } from "@/lib/cache-stats";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

type CacheEntry = {
	data: unknown;
	/** Fresh until this timestamp. */
	expiresAt: number;
	/** Stale values stay servable until this timestamp (stale-while-revalidate). */
	staleUntil: number;
};

export interface CachedOptions {
	/**
	 * How long past the TTL the last value may still be served while it is
	 * refreshed in the background. `0` (the default) recomputes synchronously on
	 * expiry, which is what callers that need an immediately-fresh value want.
	 * A small grace turns a TTL boundary from a blocking origin call into a
	 * non-blocking one, so a mass expiry can never stall requests.
	 *
	 * The window is stored on the entry, not on the caller, so a key only needs
	 * *one* call site to opt in: every other reader of that key benefits from the
	 * grace window too. That matters for hot shared keys like `online_count`,
	 * which are read from a dozen places — opt in once, centrally.
	 */
	staleMs?: number;
}

// Hard ceiling on the grace window. A window is a cushion for the TTL boundary,
// not a second TTL: it exists so a mass expiry cannot block a request, and
// keeping it short bounds how far behind a value can be served. Without a
// ceiling a single large `staleMs` silently doubles the visible staleness of a
// route (a 5 min TTL with a 5 min window serves data 10 min old), which is
// exactly the kind of thing nobody notices until a support ticket.
const MAX_STALE_MS = 120_000;

const memory = new Map<string, CacheEntry>();

function readPositiveInt(name: string, fallback: number): number {
	const raw = (process.env[name] || "").trim();
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// In-process budget. Entries are evicted least-recently-*used* (see getMemory),
// so a hot key only leaves when a hotter one takes its place. The default is
// generous because the layer exists to keep origin calls off the hot path.
const MAX_MEMORY_ENTRIES = readPositiveInt("CACHE_MEMORY_MAX_ENTRIES", 1_000);

// Single-flight: a key being (re)computed is awaited by concurrent callers
// instead of each starting its own `fn()` (cache-stampede protection).
const inFlight = new Map<string, Promise<unknown>>();

// Bumped by every invalidation. A refresh that started before the bump must not
// write its (now outdated) result back into the cache, or an invalidation
// would be silently undone by a refresh that was already in flight.
const generations = new Map<string, number>();
const MAX_GENERATION_ENTRIES = MAX_MEMORY_ENTRIES * 2;

// Keys whose most recent background refresh failed, so a persistently broken
// origin reports once instead of on every read of a hot key. Bounded so a
// high-cardinality stream of failing keys can never grow this without limit.
const MAX_REPORTED_FAILURES = 500;
const reportedFailures = new Set<string>();

function recordReportedFailure(key: string): void {
	if (reportedFailures.has(key)) return;
	if (reportedFailures.size >= MAX_REPORTED_FAILURES) {
		const oldest = reportedFailures.values().next().value;
		if (oldest !== undefined) reportedFailures.delete(oldest);
	}
	reportedFailures.add(key);
}

/** Drop a key from the in-process cache (used when an upstream value changes). */
export function invalidateMemory(key: string): void {
	generations.set(key, (generations.get(key) ?? 0) + 1);
	memory.delete(key);
	inFlight.delete(key);
	reportedFailures.delete(key);
	// A generation only matters to a refresh that is still running; once nothing
	// is in flight and the value is gone, the counter is dead weight.
	if (generations.size > MAX_GENERATION_ENTRIES) {
		for (const key of generations.keys()) {
			if (!memory.has(key) && !inFlight.has(key)) generations.delete(key);
			if (generations.size <= MAX_GENERATION_ENTRIES) break;
		}
	}
}

function pruneExpired(now: number): void {
	for (const [key, entry] of memory) {
		if (entry.staleUntil <= now) memory.delete(key);
	}
}

function setMemory(key: string, entry: CacheEntry): void {
	if (memory.has(key)) {
		memory.set(key, entry);
		return;
	}
	// Reclaim before evicting so a full map of long-lived entries never has to
	// drop a live one to make room.
	if (memory.size >= MAX_MEMORY_ENTRIES) {
		pruneExpired(Date.now());
		if (memory.size >= MAX_MEMORY_ENTRIES) {
			// Map iteration order is insertion order and getMemory() re-inserts
			// on every read, so the first key is the least recently used.
			for (const lruKey of memory.keys()) {
				memory.delete(lruKey);
				recordCacheOutcome(lruKey, "evicted");
				break;
			}
		}
	}
	memory.set(key, entry);
}

/** Current in-process budget usage, for the admin cache report. */
export function cacheBudget(): { entries: number; limit: number } {
	return { entries: memory.size, limit: MAX_MEMORY_ENTRIES };
}

/**
 * Read a key and mark it as most recently used. Re-inserting is what makes the
 * eviction above true LRU: without it, a key that is read on every single
 * request still sits at the front of the insertion order and gets evicted by an
 * unrelated burst of dynamic keys, which looks exactly like random clearing.
 */
function getMemory(key: string): CacheEntry | undefined {
	const entry = memory.get(key);
	if (entry === undefined) return undefined;
	memory.delete(key);
	memory.set(key, entry);
	return entry;
}

/** Deterministic TTL - no random jitter to prevent unpredictable drops. */
function redisTtlSeconds(ttlSec: number): number {
	return ttlSec;
}

// Deduplication: track promised values to prevent double caching/computation
const computationPromises = new Map<string, Promise<unknown>>();

// A wrong REDIS_URL or a Redis outage does not fail visibly: the cache keeps
// answering from memory and every instance quietly stops sharing. Say so once.
let warnedSharedCacheDown = false;
function warnIfSharedCacheDown(): void {
	if (redis && redis.status !== "end") return;
	if (warnedSharedCacheDown || process.env.NODE_ENV !== "production") return;
	warnedSharedCacheDown = true;
	logger.error(
		"[cache] Shared (Redis) caching is unavailable. Entries are per-process only, so they are dropped on restart and not shared between instances. Check REDIS_URL and that Redis is reachable.",
	);
}

/**
 * Redis-first cached query with an in-memory fallback.
 * Use for read-heavy endpoints polled by the browser (online count, etc.).
 */
export async function cached<T>(
	key: string,
	ttlMs: number,
	fn: () => Promise<T>,
	options: CachedOptions = {},
): Promise<T> {
	const staleMs = Math.min(Math.max(0, options.staleMs ?? 0), MAX_STALE_MS);
	// `existing &&` short-circuits so Date.now() is never evaluated during
	// prerender when the map is empty (keeps `next build` prerendering clean).
	const existing = getMemory(key);
	if (existing) {
		const now = Date.now();
		if (existing.expiresAt > now) {
			recordCacheOutcome(key, "hit");
			return existing.data as T;
		}
		if (existing.staleUntil > now) {
			recordCacheOutcome(key, "stale");
			// Serve the last good value and refresh behind it: the caller never
			// waits on the origin, and concurrent readers share one refresh.
			if (!inFlight.has(key)) {
				void refresh(key, ttlMs, staleMs, fn).catch((error: unknown) => {
					// A failed refresh keeps the stale entry until its grace window
					// runs out, then the next read recomputes synchronously. Never
					// let it surface as an unhandled rejection, and never log it per
					// read: a broken origin would otherwise flood the log from a
					// single hot key.
					if (reportedFailures.has(key)) return;
					recordReportedFailure(key);
					logger.warn("[cache] background refresh failed", {
						key,
						error: String(error),
					});
				});
			}
			return existing.data as T;
		}
		memory.delete(key);
	}

	// Single-flight: a concurrent request already recomputing this key.
	const pending = inFlight.get(key);
	if (pending) {
		recordCacheOutcome(key, "miss");
		return (await pending) as T;
	}

	// Check for existing computation promise to avoid duplicate work
	const existingPromise = computationPromises.get(key);
	if (existingPromise) {
		recordCacheOutcome(key, "miss");
		return existingPromise as Promise<T>;
	}

	recordCacheOutcome(key, "miss");
	return refresh(key, ttlMs, staleMs, fn);
}

/**
 * Recompute `key` and publish the result. Runs behind a single-flight guard, so
 * concurrent misses (and background refreshes) share one origin call.
 */
function refresh<T>(
	key: string,
	ttlMs: number,
	staleMs: number,
	fn: () => Promise<T>,
): Promise<T> {
	const generation = generations.get(key) ?? 0;
	const compute = (async (): Promise<T> => {
		// Redis path (shared across instances) - skip during tests for speed/stability
		if (process.env.NODE_ENV !== "test" && redis && redis.status !== "end") {
			try {
				const raw = await redis.get(key);
				if (raw !== null && raw !== undefined) {
					const data = JSON.parse(raw) as T;
					commit(key, data, ttlMs, staleMs, generation);
					return data;
				}
			} catch {
				/* fall through to fn */
			}
		} else if (process.env.NODE_ENV !== "test") {
			warnIfSharedCacheDown();
		}

		const data = await fn().catch((error: unknown) => {
			recordCacheOutcome(key, "error");
			throw error;
		});

		// An invalidation landed while `fn()` was running: keep the value out of
		// the cache so the next read recomputes instead of resurrecting stale data.
		if ((generations.get(key) ?? 0) === generation) {
			if (process.env.NODE_ENV !== "test" && redis && redis.status !== "end") {
				try {
					const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
					await redis.setex(key, redisTtlSeconds(ttlSec), JSON.stringify(data));
				} catch {
					/* non-critical: memory cache still works */
				}
			}
			reportedFailures.delete(key);
			commit(key, data, ttlMs, staleMs, generation);
		}

		return data;
	})().finally(() => {
		inFlight.delete(key);
		computationPromises.delete(key);
	});

	inFlight.set(key, compute);
	computationPromises.set(key, compute);
	return compute;
}

function commit(
	key: string,
	data: unknown,
	ttlMs: number,
	staleMs: number,
	generation: number,
): void {
	if ((generations.get(key) ?? 0) !== generation) return;
	const now = Date.now();
	setMemory(key, {
		data,
		expiresAt: now + ttlMs,
		staleUntil: now + ttlMs + staleMs,
	});
}

// Another process (the jobs worker, a second instance) invalidating a key must
// drop this process's copy too, otherwise a value stays stale here for the full
// TTL after everyone else already saw the new one.
onCacheInvalidated(invalidateMemory);
