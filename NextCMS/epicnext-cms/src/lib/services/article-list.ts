import "server-only";
import { and, count, desc, eq, like, or } from "drizzle-orm";
import { db, User, WebsiteArticles } from "@/lib/db";
export async function loadArticleList(
	options: { status?: string; search?: string; page?: number } = {},
) {
	const status = ["draft", "published", "scheduled"].includes(
		options.status ?? "",
	)
		? options.status
		: "all";
	const search = (options.search ?? "").trim().slice(0, 191);
	const where = and(
		status !== "all" ? eq(WebsiteArticles.status, status ?? "all") : undefined,
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
	const rows = await db
		.select({
			id: WebsiteArticles.id,
			title: WebsiteArticles.title,
			image: WebsiteArticles.image,
			createdAt: WebsiteArticles.createdAt,
			status: WebsiteArticles.status,
			author: User.username,
		})
		.from(WebsiteArticles)
		.leftJoin(User, eq(User.id, WebsiteArticles.userId))
		.where(where)
		.orderBy(desc(WebsiteArticles.createdAt), desc(WebsiteArticles.id))
		.limit(perPage)
		.offset((page - 1) * perPage);
	return { rows, page, perPage, total, lastPage, status, search };
}
