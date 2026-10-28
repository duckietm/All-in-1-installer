import { and, eq, or, sql } from "drizzle-orm";
import { apiJson } from "@/lib/api";
import { db, WebsiteArticles } from "@/lib/db";
import { logger } from "@/lib/logger";
import { apiCacheKey, cacheSafe } from "@/lib/redis-cache";
import { cacheNews } from "@/lib/services/news-cache";

/**
 * GET /cms_api/articles/:slug — single website_article by slug, including the
 * fullStory body. Returns { error } (404) when the slug is unknown.
 */
export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ slug: string }> },
) {
	const { slug } = await params;

	try {
		const data = await cacheNews(
			apiCacheKey(`articles:${slug}`),
			60_000,
			async () => {
				const [article] = await db
					.select({
						id: WebsiteArticles.id,
						title: WebsiteArticles.title,
						slug: WebsiteArticles.slug,
						shortStory: WebsiteArticles.shortStory,
						fullStory: WebsiteArticles.fullStory,
						image: WebsiteArticles.image,
						createdAt: WebsiteArticles.createdAt,
						updatedAt: WebsiteArticles.updatedAt,
					})
					.from(WebsiteArticles)
					.where(
						and(
							eq(WebsiteArticles.slug, slug),
							eq(WebsiteArticles.status, "published"),
							or(
								sql`${WebsiteArticles.publishAt} IS NULL`,
								sql`${WebsiteArticles.publishAt} <= NOW()`,
							),
						),
					)
					.limit(1);

				if (!article) {
					return null;
				}

				return cacheSafe({ data: article });
			},
		);

		if (data === null) {
			return apiJson({ error: "Article not found" }, { status: 404 });
		}

		return apiJson(data);
	} catch (error) {
		logger.error("Public news query failed", { module: "news", error });
		// DB unavailable — treat as not found rather than a 500.
		return apiJson({ error: "Article not found" }, { status: 200 });
	}
}
