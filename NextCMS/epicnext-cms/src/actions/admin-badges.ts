"use server";

import { and, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { tryGuardRank } from "@/lib/admin/rank-guard";
import { db, UsersBadges } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { rcon } from "@/lib/services/rcon";

// Bound the bulk surface so a paste bomb cannot turn into an unbounded N+1.
const MAX_USERS = 100;
const MAX_CODES = 100;
const MAX_PAIRS = 500;

export async function giveBadge(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);

	// Support comma-separated userIds and/or codes for bulk operations
	const userIdInput = String(formData.get("userId") ?? "").trim();
	const codeInput = String(formData.get("code") ?? "").trim();
	const userIds = userIdInput
		? userIdInput
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
				.slice(0, MAX_USERS)
		: [];
	const codes = codeInput
		? codeInput
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
				.slice(0, MAX_CODES)
		: [];

	if (userIds.length === 0 || codes.length === 0) {
		return;
	}

	let granted = 0;
	let failures = 0;
	for (const rawUserId of userIds) {
		const userId = Number(rawUserId);
		if (!(userId > 0)) continue;

		// Never hand badges to a target at or above the actor's rank.
		const guard = await tryGuardRank(userId, staff.rank);
		if (!guard.ok) continue;

		for (const rawCode of codes) {
			if (granted + failures >= MAX_PAIRS) break;
			// Truncate badge code to 32 characters.
			const truncatedCode = rawCode.slice(0, 32);
			if (truncatedCode.length === 0) continue;

			// Fire the emulator command so the badge appears live for online users.
			// Offline/unreachable emulator must not block the DB persistence.
			try {
				await rcon.giveBadge(userId, truncatedCode);
			} catch {
				// ignore rcon errors per pair
			}

			// Persist the badge directly so it survives a relog / offline grant.
			// users_badges has no unique (user_id, badge_code) constraint, so guard
			// against duplicates and compute the next free slot ourselves.
			try {
				const [existing] = await db
					.select({ id: UsersBadges.id })
					.from(UsersBadges)
					.where(
						and(
							eq(UsersBadges.userId, userId),
							eq(UsersBadges.badgeCode, truncatedCode),
						),
					)
					.limit(1);
				if (!existing) {
					const [agg] = await db
						.select({ maxSlot: max(UsersBadges.slotId) })
						.from(UsersBadges)
						.where(eq(UsersBadges.userId, userId));
					const slotId = (agg?.maxSlot ?? 0) + 1;
					await db.insert(UsersBadges).values({
						userId,
						slotId,
						badgeCode: truncatedCode,
					});
					granted++;
				}
			} catch {
				// A persistence failure must be visible, not silently dropped.
				failures++;
			}
		}
	}

	if (failures > 0) {
		throw new Error(
			`Failed to persist ${failures} badge grant(s); the emulator may have succeeded for some users`,
		);
	}
	if (granted > 0) {
		revalidatePath("/admin/badges");
	}
}
