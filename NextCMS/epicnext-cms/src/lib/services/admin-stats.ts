import { count, type SQL } from "drizzle-orm";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import { db } from "@/lib/db";
import { redisCache } from "@/lib/redis-cache";

/**
 * Caches admin list totals, preventing heavy COUNT(*) table scans on every
 * request for large tables.
 *
 * By default only the unfiltered (global) count is cached; filtered queries
 * hit the DB so search result counts stay exact. Callers that read a stable,
 * fixed-filter total (e.g. "open tickets") can opt into caching it too with
 * `{ cacheFiltered: true }` and a cacheKey unique to that filter.
 */
export async function getCachedAdminCount(
	table: MySqlTable,
	cacheKey: string,
	where?: SQL | undefined,
	options?: { cacheFiltered?: boolean },
): Promise<number> {
	const run = async (): Promise<number> => {
		const [row] = await db.select({ total: count() }).from(table).where(where);
		return Number(row?.total ?? 0);
	};

	if (!where || options?.cacheFiltered) {
		return await redisCache(`admin:count:${cacheKey}`, 60, run);
	}
	return await run();
}
