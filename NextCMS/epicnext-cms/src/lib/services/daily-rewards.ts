import "server-only";

import { asc, desc, eq } from "drizzle-orm";
import { db, WebsiteDailyRewardClaims, WebsiteDailyRewards } from "@/lib/db";
import { siteSettings } from "./site-settings";

export const VALID_CURRENCIES = [
	"credits",
	"duckets",
	"diamonds",
	"points",
] as const;
export type RewardCurrency = (typeof VALID_CURRENCIES)[number];

export function isRewardCurrency(value: string): value is RewardCurrency {
	return (VALID_CURRENCIES as readonly string[]).includes(value);
}

export interface DailyRewardRow {
	id: string;
	day: number;
	currency: RewardCurrency;
	amount: number;
}

/**
 * A "day" is identified by its UTC date key (YYYY-MM-DD) — a single
 * cross-timezone convention so past claims, today and "yesterday" are always
 * computed the same way. The date is stored as a DATE column via
 * `dateAsDate`, which round-trips ISO keys exactly.
 */
export function dateKey(value: Date = new Date()): string {
	return value.toISOString().slice(0, 10);
}

/** Shift a YYYY-MM-DD key by a signed number of days. */
export function shiftDayKey(key: string, days: number): string {
	const [y, m, d] = key.split("-").map(Number);
	const shifted = new Date(Date.UTC(y, m - 1, d + days));
	return shifted.toISOString().slice(0, 10);
}

export function yesterdayKey(from: Date = new Date()): string {
	return shiftDayKey(dateKey(from), -1);
}

/**
 * Resolve which reward a user's streak entitlement maps to. The cycle repeats
 * with the highest configured day number; any unconfigured day within the
 * cycle falls back to the day-1 reward.
 */
export function rewardForStreak(
	rewards: DailyRewardRow[],
	streak: number,
): DailyRewardRow | null {
	if (rewards.length === 0 || !(streak >= 1)) return null;
	const sorted = [...rewards].sort((a, b) => a.day - b.day);
	const cycle = Math.max(...sorted.map((r) => r.day));
	const dayOfCycle = ((streak - 1) % cycle) + 1;
	return sorted.find((r) => r.day === dayOfCycle) ?? sorted[0];
}

export interface DailyRewardState {
	enabled: boolean;
	today: string;
	rewards: DailyRewardRow[];
	/** null when the user has never claimed; otherwise the most recent claim. */
	lastClaim: { date: string; streak: number } | null;
	alreadyClaimedToday: boolean;
	/** Streak the next claim would land on. */
	nextStreak: number;
	/** Reward day number the next claim would grant. */
	nextRewardDay: number;
	/** Resolved reward for the next claim (null when rewards are unconfigured). */
	nextReward: DailyRewardRow | null;
}

export async function loadDailyRewardState(
	userId: number,
	now: Date = new Date(),
): Promise<DailyRewardState> {
	const today = dateKey(now);

	let enabled = true;
	let rewards: DailyRewardRow[] = [];
	let lastClaim: { date: string; streak: number } | null = null;
	try {
		enabled = await siteSettings.getBool("daily_reward_enabled", true);
		const rewardRows = await db
			.select({
				id: WebsiteDailyRewards.id,
				day: WebsiteDailyRewards.day,
				currency: WebsiteDailyRewards.currency,
				amount: WebsiteDailyRewards.amount,
			})
			.from(WebsiteDailyRewards)
			.orderBy(asc(WebsiteDailyRewards.day));
		rewards = rewardRows
			.filter((row) => isRewardCurrency(row.currency))
			.map((row) => ({
				id: String(row.id),
				day: Number(row.day),
				currency: row.currency as RewardCurrency,
				amount: Number(row.amount),
			}));

		const claimRows = await db
			.select({
				id: WebsiteDailyRewardClaims.id,
				claimDate: WebsiteDailyRewardClaims.claimDate,
				streak: WebsiteDailyRewardClaims.streak,
			})
			.from(WebsiteDailyRewardClaims)
			.where(eq(WebsiteDailyRewardClaims.userId, userId))
			.orderBy(
				desc(WebsiteDailyRewardClaims.claimDate),
				desc(WebsiteDailyRewardClaims.id),
			)
			.limit(1);
		if (claimRows[0]) {
			lastClaim = {
				date: dateKey(claimRows[0].claimDate),
				streak: Number(claimRows[0].streak),
			};
		}
	} catch {
		enabled = false;
		rewards = [];
		lastClaim = null;
	}

	const alreadyClaimedToday = lastClaim?.date === today;
	const nextStreak = !lastClaim
		? 1
		: lastClaim.date === yesterdayKey(now)
			? lastClaim.streak + 1
			: lastClaim.date === today
				? lastClaim.streak
				: 1;
	// Same day claims keep yesterday's streak (already claimed), otherwise the
	// streak for the next claim is what matters.
	const effectiveStreak =
		lastClaim?.date === today ? lastClaim.streak : nextStreak;
	const nextReward = rewardForStreak(rewards, effectiveStreak);

	return {
		enabled,
		today,
		rewards,
		lastClaim,
		alreadyClaimedToday,
		nextStreak,
		nextRewardDay: nextReward?.day ?? 1,
		nextReward,
	};
}
