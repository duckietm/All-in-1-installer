// Public REST: website store categories (website_shop_categories).
// AtomCMS JSON API parity — read-only list ordered by `order` then name.
import { asc } from "drizzle-orm";
import { apiJson, publicCacheControl } from "@/lib/api";
import { db, WebsiteShopCategories } from "@/lib/db";
import { apiCacheKey, cacheSafe, redisCache } from "@/lib/redis-cache";

export async function GET(_req: Request) {
	try {
		const data = await redisCache(
			apiCacheKey("shop:categories"),
			60,
			async () =>
				cacheSafe(
					await db
						.select({
							id: WebsiteShopCategories.id,
							name: WebsiteShopCategories.name,
							description: WebsiteShopCategories.description,
							icon: WebsiteShopCategories.icon,
							order: WebsiteShopCategories.order,
						})
						.from(WebsiteShopCategories)
						.orderBy(
							asc(WebsiteShopCategories.order),
							asc(WebsiteShopCategories.name),
						),
				),
			{ staleMs: 120_000 },
		);

		return apiJson(
			{ data },
			{ headers: { "cache-control": publicCacheControl(60) } },
		);
	} catch {
		// DB unreachable — never 500; return empty data.
		return apiJson({ data: [] }, { status: 200 });
	}
}
