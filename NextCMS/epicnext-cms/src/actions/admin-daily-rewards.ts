"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { positiveBigInt } from "@/lib/api";
import { db, WebsiteDailyRewards } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import {
	type ActionResult,
	actionError,
	actionOk,
} from "@/lib/safe-action-shared";
import { logServerError } from "@/lib/server-log";
import { siteSettings } from "@/lib/services/site-settings";

const VALID_CURRENCIES = ["credits", "duckets", "diamonds", "points"] as const;

async function normalizeReward(input: {
	day: string;
	currency: string;
	amount: string;
}): Promise<
	| { ok: true; day: number; currency: string; amount: number }
	| { ok: false; message: string }
> {
	const day = Number.parseInt(input.day, 10);
	const amount = Number.parseInt(input.amount, 10);
	const currency = String(input.currency ?? "")
		.normalize("NFC")
		.trim()
		.toLowerCase();
	if (!(day >= 1 && day <= 365))
		return { ok: false, message: "Reward day must be between 1 and 365" };
	if (!(amount > 0))
		return { ok: false, message: "Reward amount must be positive" };
	if (!(VALID_CURRENCIES as readonly string[]).includes(currency))
		return {
			ok: false,
			message: "Reward currency is not one of the emulator wallets",
		};
	return { ok: true, day, currency, amount };
}

export async function upsertDailyReward(input: {
	id?: string;
	day: string;
	currency: string;
	amount: string;
}): Promise<ActionResult> {
	await requirePermission(PERMS.DAILY_REWARDS_EDIT);

	const normalized = await normalizeReward(input);
	if (!normalized.ok) return actionError(normalized.message);

	const id = input.id ? positiveBigInt(String(input.id).trim()) : null;
	const now = new Date();

	try {
		if (id) {
			await db
				.update(WebsiteDailyRewards)
				.set({
					day: normalized.day,
					currency: normalized.currency,
					amount: normalized.amount,
					updatedAt: now,
				})
				.where(eq(WebsiteDailyRewards.id, Number(id)));
		} else {
			await db
				.insert(WebsiteDailyRewards)
				.values({
					day: normalized.day,
					currency: normalized.currency,
					amount: normalized.amount,
				})
				.onDuplicateKeyUpdate({
					set: {
						currency: normalized.currency,
						amount: normalized.amount,
						updatedAt: now,
					},
				});
		}
		revalidatePath("/admin/daily-rewards");
		revalidatePath("/me");
		return actionOk();
	} catch (error) {
		logServerError("admin.daily_reward_upsert_failed", error);
		return actionError("Reward day could not be saved");
	}
}

export async function deleteDailyReward(input: {
	id: string;
}): Promise<ActionResult> {
	await requirePermission(PERMS.DAILY_REWARDS_EDIT);

	const id = positiveBigInt(String(input.id ?? "").trim());
	if (!id) return actionError("Missing reward id");

	try {
		await db
			.delete(WebsiteDailyRewards)
			.where(eq(WebsiteDailyRewards.id, Number(id)));
		revalidatePath("/admin/daily-rewards");
		return actionOk();
	} catch (error) {
		logServerError("admin.daily_reward_delete_failed", error, {
			rewardId: String(id),
		});
		return actionError("Reward day could not be deleted");
	}
}

export async function setDailyRewardEnabled(input: {
	enabled: boolean;
}): Promise<ActionResult> {
	await requirePermission(PERMS.DAILY_REWARDS_EDIT);

	try {
		await siteSettings.update(
			"daily_reward_enabled",
			input.enabled ? "1" : "0",
		);
		revalidatePath("/admin/daily-rewards");
		return actionOk();
	} catch (error) {
		logServerError("admin.daily_reward_toggle_failed", error);
		return actionError("Reward setting could not be saved");
	}
}
