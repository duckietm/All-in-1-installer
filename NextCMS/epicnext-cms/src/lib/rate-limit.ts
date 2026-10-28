import { headers } from "next/headers";
import { resolveClientIp, UNKNOWN_CLIENT_IP } from "@/lib/client-ip";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
	ok: boolean;
	retryAfter: number;
}

const CLEANUP_INTERVAL_MS = 300_000;
const MAX_BUCKETS = 10_000;

let lastCleanup = Date.now();
let redisFailWarned = false;

function cleanup(): void {
	const now = Date.now();
	if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
	lastCleanup = now;

	for (const [k, b] of buckets) {
		if (now >= b.resetAt) buckets.delete(k);
	}

	if (buckets.size > MAX_BUCKETS) {
		const sorted = [...buckets.entries()].sort(
			(a, b) => a[1].resetAt - b[1].resetAt,
		);
		const keysToRemove = sorted
			.slice(0, Math.floor(sorted.length * 0.2))
			.map((entry) => entry[0]);
		for (const key of keysToRemove) buckets.delete(key);
	}
}

export async function rateLimit(
	key: string,
	limit: number,
	windowMs: number,
): Promise<RateLimitResult> {
	const now = Date.now();

	if (redis) {
		try {
			const windowKey = `ratelimit:${key}`;
			// One atomic round trip: INCR + PEXPIRE in a single Lua call. Two
			// separate commands left keys without a TTL whenever the process died
			// in between, which permanently locked that client out.
			const [current, ttl] = (await redis.eval(
				`local c = redis.call('INCR', KEYS[1])
				 if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
				 local t = redis.call('PTTL', KEYS[1])
				 if t < 0 then t = tonumber(ARGV[1]) end
				 return {c, t}`,
				1,
				windowKey,
				String(windowMs),
			)) as [number, number];
			if (current > limit) {
				return { ok: false, retryAfter: Math.max(1, Math.ceil(ttl / 1000)) };
			}
			return { ok: true, retryAfter: 0 };
		} catch {
			// Redis unavailable — fall through to in-memory
			if (process.env.NODE_ENV === "production" && !redisFailWarned) {
				redisFailWarned = true;
				logger.error(
					"[rate-limit] Redis error — falling back to in-process buckets. Limits are not shared across instances until Redis recovers.",
				);
			}
		}
	} else if (redisFailWarned) {
		redisFailWarned = false;
		logger.info("[rate-limit] Redis available again — shared limits restored.");
	}

	cleanup();

	const windowKey = `mem:${key}`;
	const bucket = buckets.get(windowKey);

	if (!bucket || now >= bucket.resetAt) {
		buckets.set(windowKey, { count: 1, resetAt: now + windowMs });
		return { ok: limit >= 1, retryAfter: 0 };
	}

	// The counter keeps climbing past the limit, matching Redis' INCR. Capping
	// it here would make the two backends disagree about how far over the limit
	// a key is, which breaks read-only consumers such as the login lockout.
	const newCount = bucket.count + 1;
	bucket.count = newCount;
	if (newCount > limit) {
		return {
			ok: false,
			retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
		};
	}

	return { ok: true, retryAfter: 0 };
}

/**
 * Read-only peek at a bucket — how it would judge the next call WITHOUT
 * consuming a unit.
 *
 * The login lockout needs this: it has to know whether an account is already
 * locked *before* the password is verified. Verifying first would clear the
 * counter on the success path, handing a locked account a session the moment
 * the right password turns up.
 */
export async function peekRateLimit(
	key: string,
	limit: number,
	windowMs: number,
): Promise<RateLimitResult> {
	if (redis) {
		try {
			const [countRaw, ttl] = (await redis.eval(
				`local c = redis.call('GET', KEYS[1])
				 if not c then c = 0 end
				 local t = redis.call('PTTL', KEYS[1])
				 if t < 0 then t = tonumber(ARGV[1]) end
				 return {c, t}`,
				1,
				`ratelimit:${key}`,
				String(windowMs),
			)) as [string | null, number];
			const count = Number(countRaw ?? 0);
			return {
				ok: count <= limit,
				retryAfter: Math.max(1, Math.ceil(ttl / 1000)),
			};
		} catch {
			// Redis unavailable — fall through to the in-process bucket.
		}
	}

	const bucket = buckets.get(`mem:${key}`);
	if (!bucket || Date.now() >= bucket.resetAt) {
		return { ok: true, retryAfter: 0 };
	}
	return {
		ok: bucket.count <= limit,
		retryAfter: Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000)),
	};
}

/**
 * Drop a bucket entirely, both in Redis and in-process. Required wherever a
 * successful action must reset a counter — a failed-attempt budget is only
 * usable if a success clears it.
 */
export async function clearRateLimit(key: string): Promise<void> {
	buckets.delete(`mem:${key}`);
	if (!redis) return;
	try {
		await redis.del(`ratelimit:${key}`);
	} catch {
		// Best effort: a stale key only re-arms the lockout for its own TTL.
	}
}

export async function clientIp(): Promise<string> {
	try {
		return resolveClientIp(await headers());
	} catch {
		return UNKNOWN_CLIENT_IP;
	}
}
