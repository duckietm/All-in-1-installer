import "server-only";
import { and, asc, count, desc, eq, like, or, sql } from "drizzle-orm";
import { db, WebsiteArticles } from "@/lib/db";
import { NEWS_ARCHIVE_TTL_MS } from "@/lib/perf-ttls";
import { cacheSafe } from "@/lib/redis-cache";
import { cacheNews } from "@/lib/services/news-cache";

/**
 * Fresh for a minute, then servable stale for another minute. Both the landing
 * page and /search hit this, and the COUNT(*) over a leading-wildcard LIKE is a
 * full scan of website_articles — the reason the archive felt slow once the
 * table grew. Publishing an article rotates the news revision and drops these
 * entries immediately, so the window only applies when pub/sub cannot be
 * delivered.
 */
const ARCHIVE_TTL_MS = NEWS_ARCHIVE_TTL_MS;

async function queryNewsArchive(
	options: { search?: string; page?: number; order?: string } = {},
) {
	const search = (typeof options.search === "string" ? options.search : "")
		.trim()
		.slice(0, 191);
	const order = options.order === "oldest" ? "oldest" : "newest";
	const publishedAt =
		sql<Date | null>`COALESCE(${WebsiteArticles.publishAt}, ${WebsiteArticles.createdAt})`.mapWith(
			WebsiteArticles.createdAt,
		);
	const where = and(
		eq(WebsiteArticles.status, "published"),
		or(
			sql`${WebsiteArticles.publishAt} IS NULL`,
			sql`${WebsiteArticles.publishAt} <= NOW()`,
		),
		search
			? or(
					like(WebsiteArticles.title, `%${search}%`),
					like(WebsiteArticles.shortStory, `%${search}%`),
				)
			: undefined,
	);
	const totals = await db
		.select({ value: count() })
		.from(WebsiteArticles)
		.where(where);
	const total = Number(totals[0]?.value ?? 0);
	const perPage = 24;
	const lastPage = Math.max(1, Math.ceil(total / perPage));
	const page = Math.min(
		lastPage,
		Number.isFinite(options.page)
			? Math.max(1, Math.trunc(options.page ?? 1))
			: 1,
	);
	const sort = order === "oldest" ? asc : desc;
	const rows = await db
		.select({
			slug: WebsiteArticles.slug,
			title: WebsiteArticles.title,
			shortStory: WebsiteArticles.shortStory,
			image: WebsiteArticles.image,
			createdAt: publishedAt,
		})
		.from(WebsiteArticles)
		.where(where)
		.orderBy(sort(publishedAt), sort(WebsiteArticles.id))
		.limit(perPage)
		.offset((page - 1) * perPage);
	// cacheSafe() flattens the Date into the same ISO string on both cache
	// paths. Without it a Redis hit would hand callers a string where a miss
	// hands them a Date, and the archive grid formats this field directly.
	return cacheSafe({ rows, total, page, perPage, lastPage, search, order });
}

/**
 * Keyed on the REQUESTED page rather than the clamped one, so two requests that
 * clamp onto the same page cannot alias each other's entry.
 */
function archiveKey(options: {
	search?: string;
	page?: number;
	order?: string;
}): string {
	const search = (typeof options.search === "string" ? options.search : "")
		.trim()
		.slice(0, 191);
	const order = options.order === "oldest" ? "oldest" : "newest";
	const page = Number.isFinite(options.page)
		? Math.trunc(options.page ?? 1)
		: 1;
	return `news:archive:${order}:${page}:${search}`;
}

export async function loadNewsArchive(
	options: { search?: string; page?: number; order?: string } = {},
) {
	const key = archiveKey(options);
	// cacheNews() namespaces by the news revision and owns the stale window.
	const result = await cacheNews(key, ARCHIVE_TTL_MS, () =>
		queryNewsArchive(options),
	);

	// Revive the one field callers treat as a Date. Kept outside the cache so
	// the cached value stays plain JSON.
	return {
		...result,
		rows: result.rows.map((row) => ({
			...row,
			createdAt: new Date(row.createdAt),
		})),
	};
}
