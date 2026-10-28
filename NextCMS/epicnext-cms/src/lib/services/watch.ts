import { eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db, UserWatch } from "@/lib/db";

/**
 * Returns the set of user IDs that the given staff member has marked as
 * "watch". Cached 60s + tag-invalidated by toggleUserWatch.
 */
export async function getWatchedUserIds(staffId: number): Promise<Set<number>> {
	const ids = await getCachedWatchedIds(staffId);
	return new Set(ids);
}

const getCachedWatchedIds = unstable_cache(
	async (staffId: number): Promise<number[]> => {
		const rows = await db
			.select({ targetUserId: UserWatch.targetUserId })
			.from(UserWatch)
			.where(eq(UserWatch.staffId, staffId));
		return rows.map((r) => r.targetUserId);
	},
	["user-watch-list"],
	{ revalidate: 60, tags: ["user-watch"] },
);
