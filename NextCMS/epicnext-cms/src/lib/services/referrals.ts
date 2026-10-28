import "server-only";

import { and, eq } from "drizzle-orm";
import { db, Referrals, User, UserReferrals } from "@/lib/db";
import { logger } from "@/lib/logger";
import { siteSettings } from "./site-settings";

/**
 * Attribute a registration to an inviter. Called from the register server
 * action after the account is created — it must never fail the sign-up, so
 * every step is best-effort and logged on error.
 *
 * Rules:
 *  - the `ref` username must resolve to an existing user;
 *  - self-referral is rejected;
 *  - when `referrals_block_same_ip` is enabled (default), an invitee sharing
 *    the inviter's current IP is rejected (multi-account abuse);
 *  - a duplicate inviter → invitee pair is silently ignored;
 *  - on success the pair is recorded and the inviter's tally is bumped by one.
 */
export async function recordReferral(input: {
	inviterUsername: string | null;
	inviteeId: number;
	inviteeIp: string;
}): Promise<void> {
	const username = String(input.inviterUsername ?? "")
		.normalize("NFC")
		.trim();
	if (!username) return;

	if (!Number.isSafeInteger(input.inviteeId) || input.inviteeId <= 0) return;

	try {
		const [inviter] = await db
			.select({
				id: User.id,
				username: User.username,
				ipCurrent: User.ipCurrent,
			})
			.from(User)
			.where(eq(User.username, username))
			.limit(1);
		if (!inviter) return;
		if (Number(inviter.id) === input.inviteeId) return;

		const blockSameIp = await siteSettings.getBool(
			"referrals_block_same_ip",
			true,
		);
		if (blockSameIp && inviter.ipCurrent === input.inviteeIp) return;

		const [existing] = await db
			.select({ id: Referrals.id })
			.from(Referrals)
			.where(
				and(
					eq(Referrals.userId, inviter.id),
					eq(Referrals.referredUserId, BigInt(input.inviteeId)),
				),
			)
			.limit(1);
		if (existing) return;

		const now = new Date();
		await db.insert(Referrals).values({
			userId: inviter.id,
			referredUserId: BigInt(input.inviteeId),
			referredUserIp: input.inviteeIp,
			createdAt: now,
			updatedAt: now,
		});

		const [tally] = await db
			.select({
				id: UserReferrals.id,
				referralsTotal: UserReferrals.referralsTotal,
			})
			.from(UserReferrals)
			.where(eq(UserReferrals.userId, inviter.id))
			.limit(1);
		if (tally) {
			await db
				.update(UserReferrals)
				.set({ referralsTotal: tally.referralsTotal + 1n, updatedAt: now })
				.where(eq(UserReferrals.id, tally.id));
		} else {
			await db.insert(UserReferrals).values({
				userId: inviter.id,
				referralsTotal: 1n,
				createdAt: now,
				updatedAt: now,
			});
		}
	} catch (error) {
		logger.warn("Failed to attribute referral during registration", {
			error,
			inviter: username,
			inviteeId: input.inviteeId,
		});
	}
}
