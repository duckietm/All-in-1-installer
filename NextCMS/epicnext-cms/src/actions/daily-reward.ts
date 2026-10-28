"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db, WebsiteDailyRewardClaims } from "@/lib/db";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import {
	isRewardCurrency,
	loadDailyRewardState,
} from "@/lib/services/daily-rewards";
import { rcon } from "@/lib/services/rcon";
import {
	type CurrencyName,
	currencyDb,
	sendCurrency,
} from "@/lib/services/send-currency";

/**
 * Claim the daily login reward for the SIGNED-IN user. The user id is always
 * re-read from the session — never from the form — so a crafted request cannot
 * claim on another account.
 *
 * Streak rules (see src/lib/services/daily-rewards.ts):
 *  - a claim on the day after the previous claim extends the streak;
 *  - a claim on the same day is a no-op (already claimed);
 *  - a missed day resets the streak to 1.
 * The reward schedule lives in website_daily_rewards (admin editable) and
 * repeats after the highest configured day. The unique (user_id, claim_date)
 * key makes the claim idempotent even under concurrent submits.
 *
 * Redirects back to /me with a machine-readable ?daily=<code> outcome; the
 * redirect() control-flow throw is re-thrown so navigation actually happens.
 */
const OUTCOME = [
	"claimed",
	"already_claimed",
	"disabled",
	"bad_config",
	"ratelimit",
	"error",
] as const;
type Outcome = (typeof OUTCOME)[number];

export async function claimDailyReward(_formData: FormData): Promise<void> {
	let outcome: Outcome = "error";

	try {
		const session = await auth();
		if (!session?.user?.id) redirect("/login");

		const userId = Number(session.user.id);
		if (!Number.isFinite(userId) || userId <= 0) redirect("/login");

		if (!(await rateLimit(`daily-reward-claim:${userId}`, 5, 60_000)).ok) {
			outcome = "ratelimit";
		} else {
			const state = await loadDailyRewardState(userId);

			if (!state.enabled) {
				outcome = "disabled";
			} else if (state.alreadyClaimedToday) {
				outcome = "already_claimed";
			} else if (
				!state.nextReward ||
				!isRewardCurrency(state.nextReward.currency) ||
				!(state.nextReward.amount > 0)
			) {
				outcome = "bad_config";
			} else {
				const { nextReward, nextStreak } = state;
				const claimDate = new Date(`${state.today}T00:00:00Z`);

				let claimId: number | null = null;
				try {
					// Insert first — the unique (user_id, claim_date) key is the
					// single-claim-per-day guarantee. On success the reward is paid.
					const [result] = await db.insert(WebsiteDailyRewardClaims).values({
						userId,
						claimDate,
						streak: nextStreak,
						rewardDay: nextReward.day,
						currency: nextReward.currency,
						amount: nextReward.amount,
					});
					claimId = Number(result.insertId);
				} catch (claimError) {
					const code = (claimError as { cause?: { code?: string } }).cause
						?.code;
					if (code === "ER_DUP_ENTRY") {
						outcome = "already_claimed";
					} else {
						logger.error("Daily reward claim insert failed", {
							userId,
							error: claimError,
						});
						outcome = "error";
					}
				}

				if (claimId !== null) {
					try {
						await sendCurrency(
							{ rcon, db: currencyDb },
							userId,
							nextReward.currency as CurrencyName,
							nextReward.amount,
						);
						outcome = "claimed";
					} catch {
						// Undeliverable — roll the claim back so the user can retry
						// instead of losing the reward to a broken RCON/DB write.
						try {
							await db
								.delete(WebsiteDailyRewardClaims)
								.where(eq(WebsiteDailyRewardClaims.id, BigInt(claimId)));
						} catch {
							/* best-effort rollback */
						}
						outcome = "error";
					}
				}
			}
		}
	} catch (err) {
		if (
			err &&
			typeof err === "object" &&
			"digest" in err &&
			typeof (err as { digest?: unknown }).digest === "string" &&
			(err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
		) {
			throw err;
		}
	}

	revalidatePath("/me");

	if (outcome === "claimed") {
		redirect("/me?daily=claimed");
	}
	redirect(`/me?daily=${outcome}`);
}
