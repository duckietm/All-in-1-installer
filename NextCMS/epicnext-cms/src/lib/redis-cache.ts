import "server-only";

import { type CachedOptions, cached } from "@/lib/cache";

/**
 * Cache the result of a fetch function, memory-first with a Redis fallback
 * (see `cached()`). TTL is given in seconds.
 */
export async function redisCache<T>(
	key: string,
	ttlSeconds: number,
	fetch: () => Promise<T>,
	options?: CachedOptions,
): Promise<T> {
	return cached(key, ttlSeconds * 1000, fetch, options);
}

/**
 * Build a namespaced cache key for API routes.
 */
export function apiCacheKey(path: string): string {
	return `api:${path}`;
}

/**
 * Deep-convert a payload to a JSON-cache-safe form: BigInt → string (matching
 * the apiJson() wire format) and Date → ISO string, since JSON.stringify throws
 * on BigInt. Use for payloads cached through redisCache() that are serialised
 * straight to a response and never consumed by page logic.
 */
export function cacheSafe<T>(value: T): T {
	return JSON.parse(
		JSON.stringify(value, (_k, v) =>
			typeof v === "bigint" ? v.toString() : v,
		),
	) as T;
}
