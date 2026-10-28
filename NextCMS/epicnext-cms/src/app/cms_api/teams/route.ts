import { asc, eq } from "drizzle-orm";
import { apiJson, publicCacheControl } from "@/lib/api";
import { db, WebsiteTeams } from "@/lib/db";
import { apiCacheKey, cacheSafe, redisCache } from "@/lib/redis-cache";

// Public REST API — website teams (staff ranks). Mirrors src/app/staff/page.tsx:
// visible ranks (hiddenRank=false) ordered by id.

export async function GET(_req: Request) {
	try {
		const rows = await redisCache(
			apiCacheKey("teams"),
			300,
			async () =>
				cacheSafe(
					await db
						.select({
							id: WebsiteTeams.id,
							rankName: WebsiteTeams.rankName,
							badge: WebsiteTeams.badge,
							jobDescription: WebsiteTeams.jobDescription,
							staffColor: WebsiteTeams.staffColor,
						})
						.from(WebsiteTeams)
						.where(eq(WebsiteTeams.hiddenRank, false))
						.orderBy(asc(WebsiteTeams.id)),
				),
			{ staleMs: 600_000 },
		);

		// apiJson serialises BigInt ids → string automatically.
		return apiJson(
			{ data: rows },
			{ headers: { "cache-control": publicCacheControl(300) }, status: 200 },
		);
	} catch {
		return apiJson({ data: [] }, { status: 200 });
	}
}
