import { asc, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, WebsiteDailyRewardClaims, WebsiteDailyRewards } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { siteSettings } from "@/lib/services/site-settings";
import {
	type DailyRewardEditRow,
	DailyRewardsClient,
} from "./daily-rewards-client";

export default async function AdminDailyRewards() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.DAILY_REWARDS_VIEW, session.user.rank)) {
		redirect("/admin");
	}
	const canEdit = canAccess(
		permissions,
		PERMS.DAILY_REWARDS_EDIT,
		session.user.rank,
	);

	const enabled = await siteSettings.getBool("daily_reward_enabled", true);

	let rows: DailyRewardEditRow[] = [];
	let claimsToday: number | null = null;
	let dayTotal: number | null = null;
	try {
		const schedule = await db
			.select({
				id: WebsiteDailyRewards.id,
				day: WebsiteDailyRewards.day,
				currency: WebsiteDailyRewards.currency,
				amount: WebsiteDailyRewards.amount,
			})
			.from(WebsiteDailyRewards)
			.orderBy(asc(WebsiteDailyRewards.day));
		rows = schedule.map((row) => ({
			id: String(row.id),
			day: Number(row.day),
			currency: row.currency,
			amount: Number(row.amount),
		}));

		const [[claimed], [total]] = await Promise.all([
			db
				.select({
					value: sql<number>`COUNT(*)`,
				})
				.from(WebsiteDailyRewardClaims)
				.where(sql`${WebsiteDailyRewardClaims.claimDate} = CURRENT_DATE`),
			db
				.select({ value: sql<number>`COUNT(*)` })
				.from(WebsiteDailyRewardClaims),
		]);
		claimsToday = Number(claimed?.value ?? 0);
		dayTotal = Number(total?.value ?? 0);
	} catch {
		rows = [];
		claimsToday = null;
		dayTotal = null;
	}

	return (
		<DailyRewardsClient
			rows={rows}
			enabled={enabled}
			canEdit={canEdit}
			claimsToday={claimsToday}
			dayTotal={dayTotal}
		/>
	);
}
