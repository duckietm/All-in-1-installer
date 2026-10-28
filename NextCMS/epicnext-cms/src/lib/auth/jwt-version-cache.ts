import "server-only";

import { eq } from "drizzle-orm";
import { db, User } from "@/lib/db";
import { redis } from "@/lib/redis";

const MEMORY_TTL_MS = 60_000;
const REDIS_TTL_SEC = 60;
const memory = new Map<number, { version: number; expiresAt: number }>();

// One entry per authenticated user, so without a cap a long-lived process grows
// this map by every account that ever signs in. Entries are tiny, so a generous
// bound costs almost nothing and keeps the leak impossible.
const MAX_MEMORY_ENTRIES = 20_000;

function remember(userId: number, version: number, now: number): void {
	if (memory.size >= MAX_MEMORY_ENTRIES) {
		for (const [id, entry] of memory) {
			if (entry.expiresAt <= now) memory.delete(id);
		}
		if (memory.size >= MAX_MEMORY_ENTRIES) {
			const oldest = memory.keys().next().value;
			if (oldest !== undefined) memory.delete(oldest);
		}
	}
	memory.set(userId, { version, expiresAt: now + MEMORY_TTL_MS });
}

function redisKey(userId: number): string {
	return `jwtver:${userId}`;
}

/**
 * Cached `users.website_jwt_version` for Auth.js JWT validation.
 * Avoids a DB round-trip on every authenticated request.
 */
export async function getCachedJwtVersion(
	userId: number,
): Promise<number | null> {
	if (!Number.isInteger(userId) || userId <= 0) return null;

	const now = Date.now();
	const hit = memory.get(userId);
	if (hit && hit.expiresAt > now) return hit.version;

	if (redis) {
		try {
			const raw = await redis.get(redisKey(userId));
			if (raw !== null && raw !== undefined) {
				const version = Number.parseInt(raw, 10);
				if (Number.isFinite(version)) {
					remember(userId, version, now);
					return version;
				}
			}
		} catch {
			/* fall through to DB */
		}
	}

	try {
		const [row] = await db
			.select({ websiteJwtVersion: User.websiteJwtVersion })
			.from(User)
			.where(eq(User.id, userId))
			.limit(1);
		if (!row) return null;
		const version = row.websiteJwtVersion;
		remember(userId, version, now);
		if (redis) {
			try {
				await redis.setex(redisKey(userId), REDIS_TTL_SEC, String(version));
			} catch {
				/* non-critical */
			}
		}
		return version;
	} catch {
		return null;
	}
}

/** Call after bumping website_jwt_version so other instances drop sessions ASAP. */
export async function invalidateJwtVersionCache(userId: number): Promise<void> {
	memory.delete(userId);
	if (redis) {
		try {
			await redis.del(redisKey(userId));
		} catch {
			/* non-critical */
		}
	}
}
