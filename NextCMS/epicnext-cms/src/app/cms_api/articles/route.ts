import { and, count, desc, eq, or, sql } from "drizzle-orm";
import { apiJson, pagination } from "@/lib/api";
import { db, WebsiteArticles } from "@/lib/db";
import { logger } from "@/lib/logger";
import { apiCacheKey, cacheSafe } from "@/lib/redis-cache";
import { cacheNews } from "@/lib/services/news-cache";

/**
 * GET /cms_api/articles — paginated list of website_articles, newest first.
 * Mirrors the /news page query. Returns list cards (shortStory only, never
 * fullStory) plus pagination metadata.
 */
export async function GET(req: Request) {
	const sp = new URL(req.url).searchParams;
	const { page, perPage, skip, take } = pagination(sp);

	try {
		const data = await cacheNews(
			apiCacheKey(`articles:${page}:${perPage}`),
			60_000,
			async () => {
				const publishedFilter = and(
					eq(WebsiteArticles.status, "published"),
					or(
						sql`${WebsiteArticles.publishAt} IS NULL`,
						sql`${WebsiteArticles.publishAt} <= NOW()`,
					),
				);
				const [totalRows, articles] = await Promise.all([
					db
						.select({ total: count() })
						.from(WebsiteArticles)
						.where(publishedFilter),
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
						.where(publishedFilter)
						.orderBy(desc(WebsiteArticles.createdAt))
						.limit(take)
						.offset(skip),
				]);
				return cacheSafe({
					data: articles,
					meta: {
						page,
						perPage,
						total: totalRows[0]?.total ?? 0,
						lastPage: Math.max(
							1,
							Math.ceil((totalRows[0]?.total ?? 0) / perPage),
						),
					},
				});
			},
		);

		return apiJson(data);
	} catch (error) {
		logger.error("Public news query failed", { module: "news", error });
		// DB unavailable — return an empty payload instead of a 500.
		return apiJson(
			{ data: [], meta: { page, perPage, total: 0, lastPage: 1 } },
			{ status: 200 },
		);
	}
}
