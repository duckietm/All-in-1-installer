import "server-only";

import { cloudflareEnabled, purgeCacheByTags } from "@/lib/cloudflare-api";
import { logger } from "@/lib/logger";

/**
 * Edge-cache purging for the Cloudflare layer.
 *
 * nginx tags public responses with `Cache-Tag` (cms-public, cms-gamedata,
 * cms-client, cms-camera) and a Cloudflare Cache Rule stores them at the
 * edge. Whenever the CMS edits that data (catalog, roster, shop, …) the
 * matching tag must be purged or visitors keep seeing the stale edge copy
 * until the s-maxage expires. That purge happens here.
 *
 * The helper is deliberately small and safe:
 *  - no-op when Cloudflare is not configured (CLOUDFLARE_API_TOKEN /
 *    CLOUDFLARE_ZONE_ID absent or placeholder),
 *  - callers never await it (`void purgeEdgeCache(...)`),
 *  - purges of the same tag are coalesced to at most one per 30s so a burst
 *    of edits (a catalog import touches hundreds of rows) produces one
 *    request instead of hundreds,
 *  - any API failure is logged and swallowed — the origin stays fresh and
 *    the stale window is bounded by the endpoint's s-maxage.
 */

/** The tags nginx sets in `Cache-Tag` (deployment/proxy/nginx-cms.conf). */
export const EDGE_CACHE_TAGS = {
	public: "cms-public",
	gamedata: "cms-gamedata",
	client: "cms-client",
	camera: "cms-camera",
} as const;

const COALESCE_MS = 30_000;
const recentPurges = new Map<string, number>();

/** True when at least one of `tags` is worth purging right now. */
export function shouldPurge(
	tags: string[],
	now: number = Date.now(),
): string[] {
	return tags.filter((tag) => (recentPurges.get(tag) ?? 0) + COALESCE_MS < now);
}

/**
 * Best-effort Cloudflare edge purge for the given tags. Never throws and
 * never blocks the caller. Safe to call on every admin mutation path.
 */
export async function purgeEdgeCache(
	tags: string[],
	reason: string,
): Promise<void> {
	if (!cloudflareEnabled()) return;
	const pending = shouldPurge(tags);
	if (pending.length === 0) return;
	try {
		await purgeCacheByTags(pending);
		const now = Date.now();
		for (const tag of pending) recentPurges.set(tag, now);
		logger.info("[edge-cache] Cloudflare purge sent", {
			tags: pending,
			reason,
		});
	} catch (error) {
		// A failed purge is not fatal: the freshness bound is s-maxage anyway.
		logger.warn("[edge-cache] Cloudflare purge failed", {
			tags: pending,
			reason,
			err: error,
		});
	}
}

/** Test hook only — drop in-process coalescing state between unit runs. */
export function resetEdgeCacheCoalescing(): void {
	recentPurges.clear();
}
