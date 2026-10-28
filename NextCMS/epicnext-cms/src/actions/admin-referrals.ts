"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { PERMS } from "@/lib/permissions";
import {
	type ActionResult,
	actionError,
	actionOk,
} from "@/lib/safe-action-shared";
import { logServerError } from "@/lib/server-log";
import { siteSettings } from "@/lib/services/site-settings";

/**
 * Referral system configuration for the /admin/referrals settings form. All
 * values are validated before the keys leave the CMS settings table, and the
 * reward currency must be one of the four emulator wallets (bidirectional:
 * the claim action already validates on read).
 */
const VALID_CURRENCIES = ["credits", "duckets", "diamonds", "points"] as const;

export async function updateReferralSettings(input: {
	referralsNeeded: string;
	rewardAmount: string;
	rewardCurrency: string;
	blockSameIp: string;
}): Promise<ActionResult> {
	await requirePermission(PERMS.REFERRALS_EDIT);

	const needed = Number.parseInt(input.referralsNeeded, 10);
	const amount = Number.parseInt(input.rewardAmount, 10);
	const currency = String(input.rewardCurrency ?? "")
		.normalize("NFC")
		.trim()
		.toLowerCase();

	if (!(needed >= 1)) return actionError("Referrals needed must be at least 1");
	if (!(amount > 0)) return actionError("Reward amount must be positive");
	if (!(VALID_CURRENCIES as readonly string[]).includes(currency))
		return actionError("Reward currency is not one of the emulator wallets");
	const blockSameIp = input.blockSameIp === "1";

	try {
		await siteSettings.update("referrals_needed", String(needed));
		await siteSettings.update("referral_reward_amount", String(amount));
		await siteSettings.update("referral_reward_currency_type", currency);
		await siteSettings.update(
			"referrals_block_same_ip",
			blockSameIp ? "1" : "0",
		);
		revalidatePath("/admin/referrals");
		return actionOk();
	} catch (error) {
		logServerError("admin.referral_settings_update_failed", error);
		return actionError("Referral settings could not be saved");
	}
}
