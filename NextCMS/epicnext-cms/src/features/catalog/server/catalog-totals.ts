import "server-only";
import { count, eq } from "drizzle-orm";
import { revalidateTag, unstable_cache } from "next/cache";
// Type-only import: the client merge module owns this shape, so the server
// keeps exactly one definition of it.
import type { CatalogTotals } from "@/features/catalog/client/live-catalog-merge";
import {
	CatalogItems,
	CatalogItemsBc,
	CatalogPages,
	CatalogPagesBc,
	db,
} from "@/lib/db";

export type { CatalogTotals };

/**
 * Cache tag for the admin catalog totals. Any path that writes catalog pages or
 * offers must invalidate it, otherwise the stats bar keeps serving the
 * pre-import numbers for the length of the TTL — including after a hard reload.
 */
export const CATALOG_TOTALS_TAG = "admin-catalog-totals";

export async function loadCatalogTotals(
	catalogType: "normal" | "bc",
): Promise<CatalogTotals> {
	const pagesTable = catalogType === "bc" ? CatalogPagesBc : CatalogPages;
	const itemsTable = catalogType === "bc" ? CatalogItemsBc : CatalogItems;
	const [pages, items, enabled] = await Promise.all([
		db.select({ total: count() }).from(pagesTable),
		db.select({ total: count() }).from(itemsTable),
		db
			.select({ total: count() })
			.from(pagesTable)
			.where(eq(pagesTable.enabled, "1")),
	]);
	return {
		totalPages: Number(pages[0]?.total ?? 0),
		totalItems: Number(items[0]?.total ?? 0),
		enabledPages: Number(enabled[0]?.total ?? 0),
	};
}

const getCachedTotals = unstable_cache(
	(catalogType: "normal" | "bc") => loadCatalogTotals(catalogType),
	[CATALOG_TOTALS_TAG],
	{ tags: [CATALOG_TOTALS_TAG], revalidate: 30 },
);

export function getCachedCatalogTotals(
	catalogType: "normal" | "bc",
): Promise<CatalogTotals> {
	return getCachedTotals(catalogType);
}

/**
 * Best-effort invalidation for import workers and API routes, which run outside
 * a render. A failure here must never abort an import: the cache expires on its
 * own after 30 seconds.
 */
export function invalidateCatalogTotals(): void {
	try {
		revalidateTag(CATALOG_TOTALS_TAG, { expire: 0 });
	} catch {
		// Ignore — see above.
	}
}
