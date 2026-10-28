import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-handler";
import { cacheBudget } from "@/lib/cache";
import { readCacheStats } from "@/lib/cache-stats";
import { PERMS } from "@/lib/permissions";

/**
 * Cache health report: per-key hit/miss/stale/error/eviction counters plus the
 * in-process budget, so a cache that is silently doing nothing is visible
 * instead of only showing up as "the site got slower".
 */
export const GET = withAdmin({ permission: PERMS.DEVOPS_VIEW }, async () => {
	const stats = await readCacheStats();
	return NextResponse.json({ ...stats, budget: cacheBudget() });
});
