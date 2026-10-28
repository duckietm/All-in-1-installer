import "server-only";

import { type CachedOptions, cached, invalidateMemory } from "@/lib/cache";
import { publishCacheInvalidation } from "@/lib/cache-invalidation";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

const DEFAULT_CACHE_TTL = 60;

/**
 * Redis-backed cached query with an in-process fast path (see `cached()`).
 * Use for read-heavy lookups that are safe to serve slightly stale
 * (login user, article bodies, …). Redis stays the shared source of truth.
 */
export async function cachedQuery<T>(
	cacheKey: string,
	queryFn: () => Promise<T>,
	ttl: number = DEFAULT_CACHE_TTL,
	options?: CachedOptions,
): Promise<T> {
	return cached(cacheKey, ttl * 1000, queryFn, options);
}

/** Invalidate a single cache key immediately (memory + Redis + every instance). */
export async function invalidateKey(key: string): Promise<number> {
	invalidateMemory(key);
	let removed = 0;
	if (redis && redis.status !== "end") {
		try {
			removed = await redis.del(key);
		} catch (error) {
			// A failed delete is not a reason to stay quiet: the durable copy may
			// still exist, but the other processes have to drop theirs either way,
			// otherwise this instance is the only one that sees the new value.
			logger.warn("[cache] redis delete failed", {
				key,
				error: String(error),
			});
		}
	}
	await publishCacheInvalidation(key);
	return removed;
}
