import "server-only";

import { randomUUID } from "node:crypto";
import { cached } from "@/lib/cache";
import { onCacheSignal, publishCacheSignal } from "@/lib/cache-invalidation";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

const REVISION_KEY = "cms:news:revision";

/** News entries are namespaced by a revision, so a new revision drops them all. */
const REVISION_CHANNEL = "cache:news-revision";

// The revision is read from Redis at most this often per process. Reading it on
// every call (as this used to) put a Redis round-trip in front of the in-process
// fast path, which is exactly what the cache exists to avoid. A published article
// still shows up immediately: the invalidation signal clears this copy, and the
// window is only the fallback for when pub/sub is unavailable.
const REVISION_TTL_MS = 1_000;

let revision: { value: string; expiresAt: number } | null = null;
let inFlightRevision: Promise<string> | null = null;

async function readRevision(): Promise<string> {
	const now = Date.now();
	if (revision && revision.expiresAt > now) return revision.value;
	inFlightRevision ??= (async () => {
		try {
			return (await redis?.get(REVISION_KEY)) ?? "0";
		} catch {
			return "0";
		} finally {
			inFlightRevision = null;
		}
	})();
	const value = await inFlightRevision;
	revision = { value, expiresAt: Date.now() + REVISION_TTL_MS };
	return value;
}

function setRevision(value: string): void {
	revision = { value, expiresAt: Date.now() + REVISION_TTL_MS };
}

// Another process published new news: forget the revision so the next read picks
// up the new one instead of serving entries under the old namespace.
onCacheSignal(REVISION_CHANNEL, () => {
	revision = null;
});

export async function cacheNews<T>(
	key: string,
	ttlMs: number,
	query: () => Promise<T>,
): Promise<T> {
	// Every caller of cacheNews is a public news read, so the grace window lives
	// here rather than at each call site. Publishing an article rotates the
	// revision, which drops these entries immediately; the window only matters
	// when that signal cannot be delivered.
	const options = { staleMs: ttlMs };
	// Without Redis the revision cannot be shared, so fall back to a fixed one:
	// the in-process cache still works, which is far better than hitting the
	// database on every request for the whole duration of a Redis outage.
	if (!redis || redis.status === "end")
		return cached(`news:0:${key}`, ttlMs, query, options);
	return cached(`news:${await readRevision()}:${key}`, ttlMs, query, options);
}

async function rotateRevision(): Promise<string> {
	const next = randomUUID();
	if (redis) await redis.set(REVISION_KEY, next);
	setRevision(next);
	await publishCacheSignal(REVISION_CHANNEL, next);
	return next;
}

export async function invalidateNewsCache(): Promise<void> {
	if (!redis || redis.status === "end") return;
	try {
		await rotateRevision();
	} catch (error) {
		logger.error("News saved but public cache invalidation failed", {
			module: "news",
			error,
		});
	}
}

/** Worker delivery must fail visibly so the outbox can retry the invalidation. */
export async function refreshNewsCacheForDelivery(): Promise<void> {
	if (!redis) return;
	if (redis.status === "end")
		throw new Error("News cache connection is closed");
	await rotateRevision();
}
