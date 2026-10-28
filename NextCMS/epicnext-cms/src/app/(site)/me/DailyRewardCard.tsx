import { getTranslations } from "next-intl/server";
import { claimDailyReward } from "@/actions/daily-reward";
import { CurrencyIcon } from "@/components/shared/currency-icon";
import { SurfaceCard } from "@/components/surface-card";
import {
	type DailyRewardState,
	rewardForStreak,
} from "@/lib/services/daily-rewards";
import styles from "./dashboard.module.css";

export default async function DailyRewardCard({
	state,
}: {
	state: DailyRewardState;
}) {
	const t = await getTranslations("pages.myDashboard");

	if (!state.enabled) {
		return (
			<SurfaceCard title={t("dailyRewardTitle")} bodyClassName="p-5">
				<p className="muted" role="status">
					{t("dailyRewardDisabled")}
				</p>
			</SurfaceCard>
		);
	}

	if (state.rewards.length === 0) {
		return (
			<SurfaceCard title={t("dailyRewardTitle")} bodyClassName="p-5">
				<p className="muted" role="status">
					{t("dailyRewardUnavailable")}
				</p>
			</SurfaceCard>
		);
	}

	const upcoming = state.alreadyClaimedToday
		? rewardForStreak(state.rewards, state.nextStreak + 1)
		: state.nextReward;

	return (
		<SurfaceCard title={t("dailyRewardTitle")} bodyClassName="p-5">
			<div id="daily-reward" />
			<p>{t("dailyRewardHint")}</p>
			<ul className={styles.dailyTrack}>
				{state.rewards.map((reward) => (
					<li
						key={reward.id}
						className={`${styles.dailyCell}${
							!state.alreadyClaimedToday && upcoming?.day === reward.day
								? ` ${styles.dailyCellNext}`
								: ""
						}`}
					>
						<span>{t("dailyRewardDay", { day: reward.day })}</span>
						<CurrencyIcon kind={reward.currency} size={20} alt="" />
						<strong>{reward.amount}</strong>
					</li>
				))}
			</ul>
			<p className={styles.dailyStreak}>
				{t("dailyRewardStreak", { count: state.nextStreak })}
			</p>
			{upcoming && (
				<p className={styles.reward}>
					<CurrencyIcon kind={upcoming.currency} size={20} alt="" />
					{t(
						state.alreadyClaimedToday
							? "dailyRewardTomorrow"
							: "dailyRewardNextClaim",
						{
							amount: upcoming.amount,
							currency: t.has(`currencies.${upcoming.currency}`)
								? t(`currencies.${upcoming.currency}`)
								: upcoming.currency,
						},
					)}
				</p>
			)}
			{state.alreadyClaimedToday ? (
				<p className="muted" role="status">
					{t("dailyRewardClaimedToday")}
				</p>
			) : (
				<form action={claimDailyReward} className={styles.claim}>
					<button type="submit" className="btn btn-primary">
						{t("dailyRewardClaim")}
					</button>
				</form>
			)}
		</SurfaceCard>
	);
}
