import { desc, inArray, sum } from "drizzle-orm";
import { apiJson, publicCacheControl } from "@/lib/api";
import { db, RadioListenerPoints, User } from "@/lib/db";
import { apiCacheKey, redisCache } from "@/lib/redis-cache";

// Radio listener-points leaderboard: the top 20 users by total points, summed
// across radio_listener_points and joined to users for username/look. Public
// (no auth) — mirrors the AtomCMS radio leaderboard widget.

export async function GET(_req: Request) {
	try {
		// Cached 60s: the leaderboard only changes while people listen, so a
		// short TTL keeps it fresh without re-scanning the table per request.
		const data = await redisCache(
			apiCacheKey("radio:points:leaderboard"),
			60,
			async () => {
				// Sum points per user and take the top 20 in SQL instead of
				// pulling the whole table into JS to sort/slice.
				const grouped = await db
					.select({
						userId: RadioListenerPoints.userId,
						points: sum(RadioListenerPoints.points),
					})
					.from(RadioListenerPoints)
					.groupBy(RadioListenerPoints.userId)
					.orderBy(desc(sum(RadioListenerPoints.points)))
					.limit(20);

				if (grouped.length === 0) {
					return [];
				}

				const userIds = grouped.map((r) => Number(r.userId));
				const users = await db
					.select({ id: User.id, username: User.username, look: User.look })
					.from(User)
					.where(inArray(User.id, userIds));
				const userById = new Map(users.map((u) => [u.id, u]));

				return grouped.map((r) => {
					const uid = Number(r.userId);
					const u = userById.get(uid);
					return {
						username: u?.username ?? null,
						look: u?.look ?? null,
						points: Number(r.points ?? 0),
					};
				});
			},
			{ staleMs: 120_000 },
		);

		return apiJson(
			{ data },
			{ headers: { "cache-control": publicCacheControl(60) } },
		);
	} catch {
		// DB unavailable — serve an empty leaderboard rather than a 500.
		return apiJson({ data: [] }, { status: 200 });
	}
}
