// Public REST: website store packages (website_shop_articles).
// AtomCMS JSON API parity — read-only list of buyable packages, paginated and
// ordered by `position` (then name), matching the admin /admin/shop query.
import { asc, count, eq } from "drizzle-orm";
import {
	apiError,
	apiJson,
	pagination,
	positiveBigInt,
	publicCacheControl,
} from "@/lib/api";
import { db, WebsiteShopArticles } from "@/lib/db";
import { apiCacheKey, cacheSafe, redisCache } from "@/lib/redis-cache";

export async function GET(req: Request) {
	const sp = new URL(req.url).searchParams;
	const { page, perPage, skip, take } = pagination(sp);

	// Optional ?category=<id> filter (website_shop_category_id is a BigInt).
	const categoryRaw = sp.get("category");
	let categoryId: bigint | undefined;
	if (categoryRaw !== null) {
		const parsed = positiveBigInt(categoryRaw);
		if (!parsed) return apiError("A valid category id is required", 422);
		categoryId = parsed;
	}

	try {
		const where =
			categoryId !== undefined
				? eq(WebsiteShopArticles.categoryId, categoryId)
				: undefined;

		const data = await redisCache(
			apiCacheKey(`shop:${categoryId ?? "all"}:${page}:${perPage}`),
			60,
			async () => {
				const [totalRows, rows] = await Promise.all([
					db.select({ total: count() }).from(WebsiteShopArticles).where(where),
					db
						.select({
							id: WebsiteShopArticles.id,
							categoryId: WebsiteShopArticles.categoryId,
							name: WebsiteShopArticles.name,
							info: WebsiteShopArticles.info,
							iconUrl: WebsiteShopArticles.iconUrl,
							color: WebsiteShopArticles.color,
							costs: WebsiteShopArticles.costs,
							giveRank: WebsiteShopArticles.giveRank,
							isGiftable: WebsiteShopArticles.isGiftable,
							credits: WebsiteShopArticles.credits,
							duckets: WebsiteShopArticles.duckets,
							diamonds: WebsiteShopArticles.diamonds,
							badges: WebsiteShopArticles.badges,
							furniture: WebsiteShopArticles.furniture,
							position: WebsiteShopArticles.position,
						})
						.from(WebsiteShopArticles)
						.where(where)
						.orderBy(
							asc(WebsiteShopArticles.position),
							asc(WebsiteShopArticles.name),
						)
						.limit(take)
						.offset(skip),
				]);
				return cacheSafe({
					data: rows,
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
			{ staleMs: 120_000 },
		);

		return apiJson(data, {
			headers: { "cache-control": publicCacheControl(60) },
		});
	} catch {
		// DB unreachable — never 500; return an empty, well-formed payload.
		return apiJson(
			{ data: [], meta: { page, perPage, total: 0, lastPage: 1 } },
			{ status: 200 },
		);
	}
}
