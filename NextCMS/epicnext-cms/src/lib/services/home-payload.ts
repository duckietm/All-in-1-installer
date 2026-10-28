import "server-only";

import { and, count, desc, eq, or, sql } from "drizzle-orm";
import { db, User, WebsiteArticles } from "@/lib/db";
import { resolveHotelName } from "@/lib/hotel-name";
import { HOME_PAYLOAD_TTL_MS } from "@/lib/perf-ttls";
import { apiCacheKey, cacheSafe } from "@/lib/redis-cache";
import { cacheNews } from "@/lib/services/news-cache";

/**
 * The `/cms_api/home` landing payload: latest 4 published articles plus the current
 * online player count. Shared as a loader so the cache warm-up can prime the
 * exact same key the route reads — priming a placeholder instead made every
 * instance serve a bogus `{ primed: true }` payload after each restart.
 */
export async function loadHomePayload() {
	const [articles, onlineRows, hotelName] = await Promise.all([
		db
			.select({
				id: WebsiteArticles.id,
				title: WebsiteArticles.title,
				slug: WebsiteArticles.slug,
				shortStory: WebsiteArticles.shortStory,
				image: WebsiteArticles.image,
				createdAt: WebsiteArticles.createdAt,
			})
			.from(WebsiteArticles)
			.where(
				and(
					eq(WebsiteArticles.status, "published"),
					or(
						sql`${WebsiteArticles.publishAt} IS NULL`,
						sql`${WebsiteArticles.publishAt} <= NOW()`,
					),
				),
			)
			.orderBy(desc(WebsiteArticles.createdAt))
			.limit(4),
		db.select({ total: count() }).from(User).where(eq(User.online, "1")),
		resolveHotelName(),
	]);
	return cacheSafe({
		articles,
		online: onlineRows[0]?.total ?? 0,
		hotelName,
	});
}

/** Cached read of {@link loadHomePayload} under the route's own key. */
export async function cachedHomePayload() {
	return cacheNews(apiCacheKey("home"), HOME_PAYLOAD_TTL_MS, loadHomePayload);
}
