import { desc, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
	ClaimedReferralLogs,
	db,
	Referrals,
	User,
	UserReferrals,
} from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { siteSettings } from "@/lib/services/site-settings";
import { type ReferralRow, ReferralsClient } from "./referrals-client";

export default async function AdminReferrals() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.REFERRALS_VIEW, session.user.rank)) {
		redirect("/admin");
	}
	const canEdit = canAccess(
		permissions,
		PERMS.REFERRALS_EDIT,
		session.user.rank,
	);

	const settings = await siteSettings.getMany([
		"referrals_needed",
		"referral_reward_amount",
		"referral_reward_currency_type",
		"referrals_block_same_ip",
	]);

	let rows: ReferralRow[] = [];
	let stats: {
		total: number | null;
		today: number | null;
		claimed: number | null;
		invited: number | null;
	} = { total: null, today: null, claimed: null, invited: null };

	try {
		const [[total], [today], [claimed], [invited]] = await Promise.all([
			db.select({ value: sql<number>`COUNT(*)` }).from(Referrals),
			db
				.select({ value: sql<number>`COUNT(*)` })
				.from(Referrals)
				.where(sql`${Referrals.createdAt} >= CURRENT_DATE`),
			db.select({ value: sql<number>`COUNT(*)` }).from(ClaimedReferralLogs),
			db
				.select({
					value: sql<number>`COALESCE(SUM(${UserReferrals.referralsTotal}), 0)`,
				})
				.from(UserReferrals),
		]);
		stats = {
			total: Number(total?.value ?? 0),
			today: Number(today?.value ?? 0),
			claimed: Number(claimed?.value ?? 0),
			invited: Number(invited?.value ?? 0),
		};

		const referralRows = await db
			.select({
				id: Referrals.id,
				userId: Referrals.userId,
				referredUserId: Referrals.referredUserId,
				referredUserIp: Referrals.referredUserIp,
				createdAt: Referrals.createdAt,
			})
			.from(Referrals)
			.orderBy(desc(Referrals.id))
			.limit(100);

		const userIds = new Set<number>();
		for (const r of referralRows) {
			userIds.add(Number(r.userId));
			userIds.add(Number(r.referredUserId));
		}
		const names = new Map<number, string>();
		if (userIds.size > 0) {
			const userRows = await db
				.select({ id: User.id, username: User.username })
				.from(User)
				.where(inArray(User.id, [...userIds]));
			for (const u of userRows) names.set(Number(u.id), u.username);
		}
		rows = referralRows.map((r) => ({
			id: String(r.id),
			inviter: names.get(Number(r.userId)) ?? String(r.userId),
			invitee: names.get(Number(r.referredUserId)) ?? String(r.referredUserId),
			ip: r.referredUserIp,
			createdAt: r.createdAt?.toISOString() ?? null,
		}));
	} catch {
		rows = [];
		stats = { total: null, today: null, claimed: null, invited: null };
	}

	return (
		<ReferralsClient
			rows={rows}
			stats={stats}
			canEdit={canEdit}
			settings={{
				needed: settings.referrals_needed ?? "5",
				rewardAmount: settings.referral_reward_amount ?? "30",
				rewardCurrency: settings.referral_reward_currency_type ?? "diamonds",
				blockSameIp:
					(settings.referrals_block_same_ip ?? "1").toLowerCase() === "1" ||
					(settings.referrals_block_same_ip ?? "1").toLowerCase() === "true",
			}}
		/>
	);
}
