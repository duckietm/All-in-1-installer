// Public REST: rare value categories (website_rare_value_categories).
// AtomCMS JSON API parity — read-only list ordered by priority then name,
// matching the admin /admin/rare-values query.
import { asc } from "drizzle-orm";
import { apiJson, publicCacheControl } from "@/lib/api";
import { db, WebsiteRareValueCategories } from "@/lib/db";
import { apiCacheKey, cacheSafe, redisCache } from "@/lib/redis-cache";

export async function GET(_req: Request) {
	try {
		const data = await redisCache(
			apiCacheKey("values:categories"),
			300,
			async () =>
				cacheSafe(
					await db
						.select({
							id: WebsiteRareValueCategories.id,
							name: WebsiteRareValueCategories.name,
							badge: WebsiteRareValueCategories.badge,
							priority: WebsiteRareValueCategories.priority,
						})
						.from(WebsiteRareValueCategories)
						.orderBy(
							asc(WebsiteRareValueCategories.priority),
							asc(WebsiteRareValueCategories.name),
						),
				),
			{ staleMs: 600_000 },
		);

		return apiJson(
			{ data },
			{ headers: { "cache-control": publicCacheControl(300) } },
		);
	} catch {
		// DB unreachable — never 500; return empty data.
		return apiJson({ data: [] }, { status: 200 });
	}
}
