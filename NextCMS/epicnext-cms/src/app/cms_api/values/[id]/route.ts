// Public REST: a single rare furni trade value by id (website_rare_values),
// together with its parent category. AtomCMS JSON API parity. Returns { error }
// (404) when the id is unknown.
import { eq } from "drizzle-orm";
import { apiJson, publicCacheControl } from "@/lib/api";
import { db, WebsiteRareValueCategories, WebsiteRareValues } from "@/lib/db";
import { apiCacheKey, cacheSafe, redisCache } from "@/lib/redis-cache";

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;

	// The primary key is a BigInt; reject non-numeric ids up front.
	if (!/^\d+$/.test(id)) {
		return apiJson({ error: "Rare value not found" }, { status: 404 });
	}

	let valueId: bigint;
	try {
		valueId = BigInt(id);
	} catch {
		return apiJson({ error: "Rare value not found" }, { status: 404 });
	}

	try {
		const data = await redisCache(
			apiCacheKey(`values:${id}`),
			300,
			async () => {
				const [value] = await db
					.select({
						id: WebsiteRareValues.id,
						categoryId: WebsiteRareValues.categoryId,
						itemId: WebsiteRareValues.itemId,
						name: WebsiteRareValues.name,
						creditValue: WebsiteRareValues.creditValue,
						currencyValue: WebsiteRareValues.currencyValue,
						currencyType: WebsiteRareValues.currencyType,
						furnitureIcon: WebsiteRareValues.furnitureIcon,
						createdAt: WebsiteRareValues.createdAt,
						updatedAt: WebsiteRareValues.updatedAt,
					})
					.from(WebsiteRareValues)
					.where(eq(WebsiteRareValues.id, valueId))
					.limit(1);

				if (!value) {
					return null;
				}

				// No relation is modelled between the value and its category, so resolve the
				// category in a second guarded query.
				let category: {
					id: bigint;
					name: string;
					badge: string;
					priority: number;
				} | null = null;
				try {
					const [row] = await db
						.select({
							id: WebsiteRareValueCategories.id,
							name: WebsiteRareValueCategories.name,
							badge: WebsiteRareValueCategories.badge,
							priority: WebsiteRareValueCategories.priority,
						})
						.from(WebsiteRareValueCategories)
						.where(eq(WebsiteRareValueCategories.id, value.categoryId))
						.limit(1);
					category = row ?? null;
				} catch {
					category = null;
				}

				return cacheSafe({ data: { ...value, category } });
			},
			{ staleMs: 300_000 },
		);

		if (data === null) {
			return apiJson({ error: "Rare value not found" }, { status: 404 });
		}

		return apiJson(data, {
			headers: { "cache-control": publicCacheControl(300) },
		});
	} catch {
		// DB unavailable — treat as not found rather than a 500.
		return apiJson({ error: "Rare value not found" }, { status: 200 });
	}
}
