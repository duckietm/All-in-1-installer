import { logger } from "@/lib/logger";
import { NEWS_LIST_TTL_MS } from "@/lib/perf-ttls";
import { cacheNews } from "@/lib/services/news-cache";
import "server-only";

import { and, desc, eq, or, sql } from "drizzle-orm";
import { db, WebsiteArticles } from "@/lib/db";

export interface NewsListItem {
	slug: string;
	title: string;
	shortStory: string;
	image: string;
	createdAt: Date | null;
}

interface NewsListRow {
	slug: string;
	title: string;
	shortStory: string;
	image: string;
	createdAt: Date | null;
}

const TTL_MS = NEWS_LIST_TTL_MS;
const CACHE_KEY = "news_list";
const FETCH_LIMIT = 30;

/**
 * Shared, cached news preview list used by the homepage and other widgets so
 * a single "news_list" cache entry serves both routes. Returns at most
 * `limit` rows with `createdAt` normalized to a Date (the cache round-trip
 * serializes timestamps to ISO strings).
 */
export async function getNewsList(
	limit: number,
	options: { throwOnError?: boolean } = {},
): Promise<NewsListItem[]> {
	try {
		const rows = await cacheNews<NewsListRow[]>(CACHE_KEY, TTL_MS, () =>
			db
				.select({
					slug: WebsiteArticles.slug,
					title: WebsiteArticles.title,
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
				.limit(FETCH_LIMIT),
		);
		return rows
			.map((a) => ({
				...a,
				createdAt: a.createdAt ? new Date(a.createdAt) : null,
			}))
			.slice(0, limit);
	} catch (error) {
		if (options.throwOnError) throw error;
		logger.error("Public news query failed", { module: "news", error });
		return [];
	}
}
