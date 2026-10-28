"use server";

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
	ClaimedReferralLogs,
	db,
	UserReferrals,
	WebsiteSetting,
} from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { rcon } from "@/lib/services/rcon";
import {
	type CurrencyName,
	currencyDb,
	sendCurrency,
} from "@/lib/services/send-currency";

/**
 * Claim the referral reward for the SIGNED-IN user. Faithful to AtomCMS's
 * ReferralController::__invoke:
 *   - the user id is re-read from the session (auth()), NEVER from FormData,
 *     so a crafted form cannot claim on another account;
 *   - the user must have referred at least `referrals_needed` people
 *     (user_referrals.referrals_total >= needed), otherwise it's rejected;
 *   - on success `referrals_total` is decremented by the threshold, the
 *     configured reward is granted, and the claim is logged.
 *
 * The reward amount/currency are CMS-configurable via website_settings
 * (referral_reward_amount + referral_reward_currency_type). If the currency
 * setting is not one of the four known wallets we keep the claim conservative
 * and fail rather than guessing — no currency is moved.
 *
 * Errors redirect back to /me with a machine-readable ?error= code; success
 * redirects with ?claimed=1. redirect() is called OUTSIDE the try/catch so its
 * internal control-flow throw is never swallowed.
 */
const VALID_CURRENCIES = new Set<CurrencyName>([
	"credits",
	"duckets",
	"diamonds",
	"points",
]);

export async function claimReferral(_formData: FormData): Promise<void> {
	let outcome:
		| "claimed"
		| "not_enough"
		| "no_referrals"
		| "bad_config"
		| "ratelimit"
		| "error" = "error";

	try {
		const session = await auth();
		if (!session?.user?.id) {
			redirect("/login");
		}

		const userId = Number(session.user.id);
		if (!Number.isFinite(userId) || userId <= 0) {
			redirect("/login");
		}

		await clientIp();
		if (!(await rateLimit(`referral-claim:${userId}`, 5, 60_000)).ok) {
			outcome = "ratelimit";
		} else {
			// Reward configuration (CMS-owned website_settings). AtomCMS defaults:
			// 5 referrals needed, 30 diamonds reward.
			const settingKeys = [
				"referrals_needed",
				"referral_reward_amount",
				"referral_reward_currency_type",
				"referral_reward_currency",
			] as const;

			let settings: Array<{ key: string; value: string }> = [];
			try {
				settings = await db
					.select({ key: WebsiteSetting.key, value: WebsiteSetting.value })
					.from(WebsiteSetting)
					.where(inArray(WebsiteSetting.key, [...settingKeys]));
			} catch {
				settings = [];
			}

			const byKey = new Map(settings.map((s) => [s.key, s.value]));
			const neededRaw = byKey.get("referrals_needed");
			const amountRaw = byKey.get("referral_reward_amount");
			// The seeded key is referral_reward_currency_type; fall back to the
			// shorter referral_reward_currency name if that is what is configured.
			const currencyRaw =
				byKey.get("referral_reward_currency_type") ??
				byKey.get("referral_reward_currency");

			const needed = Number.parseInt(neededRaw ?? "5", 10) || 5;
			const amount = Number.parseInt(amountRaw ?? "30", 10);
			const currency = (currencyRaw ?? "diamonds")
				.trim()
				.toLowerCase() as CurrencyName;

			// The user's referral tally lives in user_referrals (one row per user).
			let referrals: { id: bigint; referralsTotal: bigint } | undefined;
			try {
				const rows = await db
					.select({
						id: UserReferrals.id,
						referralsTotal: UserReferrals.referralsTotal,
					})
					.from(UserReferrals)
					.where(eq(UserReferrals.userId, userId))
					.orderBy(desc(UserReferrals.id))
					.limit(1);
				referrals = rows[0];
			} catch {
				referrals = undefined;
			}
			const total = referrals ? Number(referrals.referralsTotal) : 0;

			if (!referrals || total <= 0) {
				outcome = "no_referrals";
			} else if (total < needed) {
				outcome = "not_enough";
			} else if (!VALID_CURRENCIES.has(currency) || !(amount > 0)) {
				// Misconfigured reward — keep it conservative and grant nothing.
				outcome = "bad_config";
			} else {
				// Spend the threshold first so a concurrent double-submit can't claim
				// twice off the same balance, then deliver the reward and log it.
				// Only while the balance still covers it: parallel claims cannot all spend it.
				const [spent] = await db
					.update(UserReferrals)
					.set({
						referralsTotal: sql`${UserReferrals.referralsTotal} - ${needed}`,
					})
					.where(
						and(
							eq(UserReferrals.id, referrals.id),
							gte(UserReferrals.referralsTotal, BigInt(needed)),
						),
					);
				if (Number(spent.affectedRows ?? 0) !== 1) {
					outcome = "not_enough";
				} else {
					try {
						await sendCurrency(
							{ rcon, db: currencyDb },
							userId,
							currency,
							amount,
						);
					} catch {
						// sendCurrency already falls back to a direct DB write; if it still
						// throws the spend stands. Roll the threshold back so the user isn't
						// charged for an undelivered reward.
						try {
							await db
								.update(UserReferrals)
								.set({
									referralsTotal: sql`${UserReferrals.referralsTotal} + ${needed}`,
								})
								.where(eq(UserReferrals.id, referrals.id));
						} catch {
							/* best-effort rollback */
						}
						outcome = "error";
						throw new Error("currency-delivery-failed");
					}

					try {
						await db.insert(ClaimedReferralLogs).values({
							userId,
							ipAddress: await clientIp(),
							createdAt: new Date(),
							updatedAt: new Date(),
						});
					} catch {
						// Best-effort audit log; the reward already landed.
					}
					outcome = "claimed";
				}
			}
		}
	} catch (err) {
		// redirect() throws a NEXT_REDIRECT control-flow signal — re-throw it so the
		// navigation actually happens instead of being treated as a failure.
		if (
			err &&
			typeof err === "object" &&
			"digest" in err &&
			typeof (err as { digest?: unknown }).digest === "string" &&
			(err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
		) {
			throw err;
		}
		if (outcome === "claimed") outcome = "error";
	}

	revalidatePath("/me");

	if (outcome === "claimed") {
		redirect("/me?claimed=1");
	}
	redirect(`/me?error=${outcome}`);
}
