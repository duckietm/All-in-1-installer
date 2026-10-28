import { asc, desc, gte } from "drizzle-orm";
import { apiJson, publicCacheControl } from "@/lib/api";
import { db, User } from "@/lib/db";
import { apiCacheKey, redisCache } from "@/lib/redis-cache";
import { siteSettings } from "@/lib/services/site-settings";

// Public REST API — staff list. Mirrors src/app/staff/page.tsx: users whose
// rank is >= min_staff_rank (default 7). Only safe fields are exposed.

export async function GET(_req: Request) {
	try {
		const minStaffRank =
			Number(await siteSettings.get("min_staff_rank", "7")) || 7;

		const staff = await redisCache(
			apiCacheKey("staff"),
			300,
			() =>
				db
					.select({
						username: User.username,
						look: User.look,
						rank: User.rank,
						motto: User.motto,
					})
					.from(User)
					.where(gte(User.rank, minStaffRank))
					.orderBy(desc(User.rank), asc(User.username))
					.limit(100),
			// Staff badges are rendered on every public page; a roster that is a
			// few minutes behind must never turn into a query on each visitor.
			{ staleMs: 300 },
		);

		return apiJson(
			{ data: staff },
			{ headers: { "cache-control": publicCacheControl(300) }, status: 200 },
		);
	} catch {
		// Never 500 — serve an empty payload if the DB is unreachable.
		return apiJson({ data: [] }, { status: 200 });
	}
}
