import "server-only";
import { and, asc, count, eq, or, sql } from "drizzle-orm";
import {
	db,
	User,
	WebsiteArticleComments,
	WebsiteArticleReactions,
	WebsiteArticles,
} from "@/lib/db";
import { cacheNews } from "@/lib/services/news-cache";

/** Null means a successful lookup found no public article. Failed reads must reject. */
export async function getPublishedArticle(slug: string) {
	const cached = await cacheNews(
		`article:v2:slug:${slug}`,
		60_000,
		async () => {
			const [article] = await db
				.select({
					id: WebsiteArticles.id,
					slug: WebsiteArticles.slug,
					title: WebsiteArticles.title,
					shortStory: WebsiteArticles.shortStory,
					fullStory: WebsiteArticles.fullStory,
					image: WebsiteArticles.image,
					createdAt: WebsiteArticles.createdAt,
					updatedAt: WebsiteArticles.updatedAt,
					publishAt: WebsiteArticles.publishAt,
					publishedAt: WebsiteArticles.publishedAt,
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
			if (!article) return null;
			// Redis uses JSON: preserve full bigint precision and restore dates on reads.
			return {
				...article,
				id: String(article.id),
				createdAt: article.createdAt?.toISOString() ?? null,
				updatedAt: article.updatedAt?.toISOString() ?? null,
				publishAt: article.publishAt?.toISOString() ?? null,
				publishedAt: article.publishedAt?.toISOString() ?? null,
			};
		},
	);
	if (!cached) return null;
	return {
		...cached,
		id: BigInt(cached.id),
		createdAt: cached.createdAt ? new Date(cached.createdAt) : null,
		updatedAt: cached.updatedAt ? new Date(cached.updatedAt) : null,
		publishAt: cached.publishAt ? new Date(cached.publishAt) : null,
		publishedAt: cached.publishedAt ? new Date(cached.publishedAt) : null,
	};
}

export type PublishedArticle = NonNullable<
	Awaited<ReturnType<typeof getPublishedArticle>>
>;

export async function getArticleComments(
	articleId: bigint,
	requestedPage: number | "last" = 1,
) {
	const where = eq(WebsiteArticleComments.articleId, articleId);
	const [totals] = await db
		.select({ value: count() })
		.from(WebsiteArticleComments)
		.where(where);
	const total = Number(totals?.value ?? 0);
	const perPage = 25;
	const lastPage = Math.max(1, Math.ceil(total / perPage));
	const page =
		requestedPage === "last"
			? lastPage
			: Math.min(
					lastPage,
					Number.isFinite(requestedPage)
						? Math.max(1, Math.trunc(requestedPage))
						: 1,
				);
	const rows = await db
		.select({
			id: WebsiteArticleComments.id,
			userId: WebsiteArticleComments.userId,
			comment: WebsiteArticleComments.comment,
			createdAt: WebsiteArticleComments.createdAt,
			username: User.username,
		})
		.from(WebsiteArticleComments)
		.leftJoin(User, eq(User.id, WebsiteArticleComments.userId))
		.where(where)
		.orderBy(
			asc(WebsiteArticleComments.createdAt),
			asc(WebsiteArticleComments.id),
		)
		.limit(perPage)
		.offset((page - 1) * perPage);
	return { rows, total, page, perPage, lastPage };
}

export type ArticleComments = Awaited<ReturnType<typeof getArticleComments>>;

export async function getArticleReactions(
	articleId: bigint,
	userId: number | null,
) {
	const rows = await db
		.select({
			reaction: WebsiteArticleReactions.reaction,
			count: count(),
			mine:
				userId === null
					? sql<number>`0`
					: sql<number>`MAX(CASE WHEN ${WebsiteArticleReactions.userId} = ${userId} THEN 1 ELSE 0 END)`,
		})
		.from(WebsiteArticleReactions)
		.where(
			and(
				eq(WebsiteArticleReactions.articleId, articleId),
				eq(WebsiteArticleReactions.active, true),
			),
		)
		.groupBy(WebsiteArticleReactions.reaction);
	return {
		counts: new Map(rows.map((row) => [row.reaction, Number(row.count)])),
		myReaction: rows.find((row) => Number(row.mine) > 0)?.reaction ?? null,
	};
}

export type ArticleReactions = Awaited<ReturnType<typeof getArticleReactions>>;
