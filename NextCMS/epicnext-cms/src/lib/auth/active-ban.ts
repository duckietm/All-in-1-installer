import { and, eq, gt, or } from "drizzle-orm";
import { unixNow } from "@/lib/bans";
import { Ban, db } from "@/lib/db";

/** Whether the account has a ban that has not expired (banExpire 0 = permanent). */
export async function hasActiveBan(userId: number): Promise<boolean> {
	const [ban] = await db
		.select({ id: Ban.id })
		.from(Ban)
		.where(
			and(
				eq(Ban.userId, userId),
				or(eq(Ban.banExpire, 0), gt(Ban.banExpire, unixNow())),
			),
		)
		.limit(1);
	return Boolean(ban);
}
