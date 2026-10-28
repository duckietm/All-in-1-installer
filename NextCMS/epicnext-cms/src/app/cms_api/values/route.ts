// Public REST: rare furni trade values (website_rare_values).
// AtomCMS JSON API parity — read-only catalog of rares with their credit /
// currency values. Supports ?category=<id> filter; paginated, ordered by name.
import { asc, count, eq } from "drizzle-orm";
import {
	apiError,
	apiJson,
	pagination,
	positiveBigInt,
	publicCacheControl,
} from "@/lib/api";
import { db, WebsiteRareValues } from "@/lib/db";
import { apiCacheKey, cacheSafe, redisCache } from "@/lib/redis-cache";

export async function GET(req: Request) {
	const sp = new URL(req.url).searchParams;
	const { page, perPage, skip, take } = pagination(sp);

	// Optional ?category=<id> filter (category_id is a BigInt).
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
				? eq(WebsiteRareValues.categoryId, categoryId)
				: undefined;

		const data = await redisCache(
			apiCacheKey(`values:${categoryId ?? "all"}:${page}:${perPage}`),
			300,
			async () => {
				const [totalRows, rows] = await Promise.all([
					db.select({ total: count() }).from(WebsiteRareValues).where(where),
					db
						.select({
							id: WebsiteRareValues.id,
							categoryId: WebsiteRareValues.categoryId,
							itemId: WebsiteRareValues.itemId,
							name: WebsiteRareValues.name,
							creditValue: WebsiteRareValues.creditValue,
							currencyValue: WebsiteRareValues.currencyValue,
							currencyType: WebsiteRareValues.currencyType,
							furnitureIcon: WebsiteRareValues.furnitureIcon,
						})
						.from(WebsiteRareValues)
						.where(where)
						.orderBy(asc(WebsiteRareValues.name))
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
			{ staleMs: 300_000 },
		);

		return apiJson(data, {
			headers: { "cache-control": publicCacheControl(300) },
		});
	} catch {
		// DB unreachable — never 500; return an empty, well-formed payload.
		return apiJson(
			{ data: [], meta: { page, perPage, total: 0, lastPage: 1 } },
			{ status: 200 },
		);
	}
}
