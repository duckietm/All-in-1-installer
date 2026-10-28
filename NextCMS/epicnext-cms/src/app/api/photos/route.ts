import { count, desc } from "drizzle-orm";
import { apiJson, pagination, publicCacheControl } from "@/lib/api";
import { CameraWeb, db } from "@/lib/db";
import { apiCacheKey, cacheSafe, redisCache } from "@/lib/redis-cache";

/**
 * GET /api/photos — recent community photos (camera_web), newest first.
 * Mirrors the /photos page query. Returns id, userId, url and timestamp plus
 * pagination metadata.
 */
export async function GET(req: Request) {
	const sp = new URL(req.url).searchParams;
	const { page, perPage, skip, take } = pagination(sp);

	try {
		const data = await redisCache(
			apiCacheKey(`photos:${page}:${perPage}`),
			60,
			async () => {
				const [totalRows, photos] = await Promise.all([
					db.select({ total: count() }).from(CameraWeb),
					db
						.select({
							id: CameraWeb.id,
							userId: CameraWeb.userId,
							url: CameraWeb.url,
							timestamp: CameraWeb.timestamp,
						})
						.from(CameraWeb)
						.orderBy(desc(CameraWeb.timestamp))
						.limit(take)
						.offset(skip),
				]);

				// Photo privacy is a per-user setting, so the API honours it like
				// the /photos page does.
				const { loadProfilePrivacyMap } = await import(
					"@/lib/services/profile-privacy"
				);
				const photoPrivacy = await loadProfilePrivacyMap(
					photos.map((p) => p.userId),
				);

				return cacheSafe({
					data: photos.filter(
						(p) => photoPrivacy.get(p.userId)?.photos !== false,
					),
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
		// DB unavailable — return an empty payload instead of a 500.
		return apiJson(
			{ data: [], meta: { page, perPage, total: 0, lastPage: 1 } },
			{ status: 200 },
		);
	}
}
