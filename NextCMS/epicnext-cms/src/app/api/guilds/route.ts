// Public REST: hotel guilds (guilds). AtomCMS JSON API parity — read-only,
// paginated list ordered newest first (by id), exposing the basic public
// fields. The owner is stored as the user_id column (accessor userId), surfaced
// here as ownerId for API clarity.
import { count, desc } from "drizzle-orm";
import { apiJson, pagination, publicCacheControl } from "@/lib/api";
import { db, Guilds } from "@/lib/db";
import { apiCacheKey, cacheSafe, redisCache } from "@/lib/redis-cache";

export async function GET(req: Request) {
	const sp = new URL(req.url).searchParams;
	const { page, perPage, skip, take } = pagination(sp);

	try {
		const data = await redisCache(
			apiCacheKey(`guilds:${page}:${perPage}`),
			120,
			async () => {
				const [totalRows, rows] = await Promise.all([
					db.select({ total: count() }).from(Guilds),
					db
						.select({
							id: Guilds.id,
							name: Guilds.name,
							description: Guilds.description,
							userId: Guilds.userId,
						})
						.from(Guilds)
						.orderBy(desc(Guilds.id))
						.limit(take)
						.offset(skip),
				]);

				// Rename userId → ownerId for the public payload.
				const renamed = rows.map(({ userId, ...rest }) => ({
					...rest,
					ownerId: userId,
				}));

				return cacheSafe({
					data: renamed,
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
			headers: { "cache-control": publicCacheControl(120) },
		});
	} catch {
		// DB unreachable — never 500; return an empty, well-formed payload.
		return apiJson(
			{ data: [], meta: { page, perPage, total: 0, lastPage: 1 } },
			{ status: 200 },
		);
	}
}
