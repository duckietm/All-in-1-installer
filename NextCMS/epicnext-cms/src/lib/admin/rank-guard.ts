import { eq } from "drizzle-orm";
import { isDynamicSuperAdmin } from "@/lib/admin/authorization-policy";
import { db, User } from "@/lib/db";
import { getHighestRank } from "@/lib/permissions";
import { ActionError } from "@/lib/safe-action-shared";

export interface RankGuardTarget {
	username: string;
	rank: number;
	mail: string | null;
}

export type RankGuardResult =
	| { ok: true; target: RankGuardTarget }
	| { ok: false; reason: "not_found" | "rank" };

/**
 * Refuse to act on a target whose rank is equal to or higher than the actor's,
 * unless the actor is the dynamic super admin (the account holding the hotel's
 * current highest rank). This is the single source of truth for the
 * "cannot modify equal/higher rank" invariant; every admin action that mutates
 * a specific user must go through it.
 *
 * Returns a discriminated result instead of throwing so callers can choose
 * between "block the request" and "tolerate a deleted user" (e.g. lifting a
 * ban for an account that no longer exists).
 */
export async function tryGuardRank(
	targetUserId: number,
	sessionRank: number,
): Promise<RankGuardResult> {
	const [target] = await db
		.select({
			username: User.username,
			rank: User.rank,
			mail: User.mail,
		})
		.from(User)
		.where(eq(User.id, targetUserId))
		.limit(1);
	if (!target) return { ok: false, reason: "not_found" };
	const highestRank = await getHighestRank();
	if (
		target.rank >= sessionRank &&
		!isDynamicSuperAdmin(sessionRank, highestRank)
	) {
		return { ok: false, reason: "rank" };
	}
	return { ok: true, target };
}

export async function guardRank(
	targetUserId: number,
	sessionRank: number,
): Promise<RankGuardTarget> {
	const result = await tryGuardRank(targetUserId, sessionRank);
	if (!result.ok) {
		throw new ActionError(
			result.reason === "not_found"
				? "User not found"
				: "Cannot modify user with equal or higher rank",
		);
	}
	return result.target;
}
