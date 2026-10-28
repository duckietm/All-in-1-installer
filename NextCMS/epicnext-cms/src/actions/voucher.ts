"use server";

import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db, WebsiteShopVouchers, WebsiteUsedShopVouchers } from "@/lib/db";
import { formatNumber } from "@/lib/format-date";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { rcon } from "@/lib/services/rcon";
import { currencyDb, sendCurrency } from "@/lib/services/send-currency";

/** Feedback returned to the <RedeemForm/> client component via useActionState. */
export type RedeemState = { ok: boolean; message: string } | null;

/**
 * Redeem a shop voucher for the SIGNED-IN user. Faithful to AtomCMS's
 * ShopVoucherController:
 *   - the user id is re-read from the session (auth()), NEVER from FormData,
 *     so a crafted form cannot redeem on another account;
 *   - a code that is missing or expired is rejected;
 *   - each voucher may be redeemed once per user (website_used_shop_vouchers);
 *   - on success the reward `amount` is granted, the used-row is inserted,
 *     use_count is incremented, and the voucher is expired once max_uses is hit.
 *
 * The reward is delivered through sendCurrency({ rcon, db: currencyDb }); the
 * voucher schema carries a single `amount`, granted as the website credits
 * wallet currency.
 */
export async function redeem(
	_prev: RedeemState,
	formData: FormData,
): Promise<RedeemState> {
	const session = await auth();
	if (!session?.user?.id) {
		return { ok: false, message: "You must be signed in to redeem a voucher." };
	}

	const userId = Number(session.user.id);
	if (!Number.isFinite(userId)) {
		return {
			ok: false,
			message: "Your session is invalid. Please sign in again.",
		};
	}

	await clientIp();
	if (!(await rateLimit(`voucher-redeem:${userId}`, 5, 60_000)).ok) {
		return {
			ok: false,
			message: "You're redeeming too fast. Please wait a moment and try again.",
		};
	}

	const code = String(formData.get("code") ?? "")
		.normalize("NFC")
		.trim();
	if (!code) {
		return { ok: false, message: "Please enter a voucher code." };
	}

	// Look up the code (website_shop_vouchers.code is unique).
	let voucher: {
		id: bigint;
		amount: number;
		maxUses: number;
		useCount: number;
		expiresAt: Date | null;
	} | null;
	try {
		const [row] = await db
			.select({
				id: WebsiteShopVouchers.id,
				amount: WebsiteShopVouchers.amount,
				maxUses: WebsiteShopVouchers.maxUses,
				useCount: WebsiteShopVouchers.useCount,
				expiresAt: WebsiteShopVouchers.expiresAt,
			})
			.from(WebsiteShopVouchers)
			.where(eq(WebsiteShopVouchers.code, code))
			.limit(1);
		voucher = row ?? null;
	} catch {
		return {
			ok: false,
			message: "We couldn't reach the server. Please try again.",
		};
	}

	// Not found OR already expired -> generic "no active voucher" (matches AtomCMS).
	if (
		!voucher ||
		(voucher.expiresAt && voucher.expiresAt.getTime() <= Date.now())
	) {
		return {
			ok: false,
			message: "No active voucher with the given code was found.",
		};
	}

	// One redemption per user.
	try {
		const [already] = await db
			.select({ id: WebsiteUsedShopVouchers.id })
			.from(WebsiteUsedShopVouchers)
			.where(
				and(
					eq(WebsiteUsedShopVouchers.userId, userId),
					eq(WebsiteUsedShopVouchers.voucherId, voucher.id),
				),
			)
			.limit(1);
		if (already) {
			return { ok: false, message: "You can only use each shop voucher once." };
		}
	} catch {
		return {
			ok: false,
			message: "We couldn't reach the server. Please try again.",
		};
	}

	// Claim one use and record the redemption in one transaction, before granting: the use is only taken
	// while the voucher still has uses left and has not expired, and the unique (user_id, voucher_id) key
	// (migration 0036) makes a parallel second redemption fail and roll back.
	const voucherId = voucher.id;
	let claimed: "ok" | "exhausted";
	try {
		claimed = await db.transaction(async (tx) => {
			const [result] = await tx
				.update(WebsiteShopVouchers)
				.set({ useCount: sql`${WebsiteShopVouchers.useCount} + 1` })
				.where(
					and(
						eq(WebsiteShopVouchers.id, voucherId),
						or(
							eq(WebsiteShopVouchers.maxUses, 0),
							lt(WebsiteShopVouchers.useCount, WebsiteShopVouchers.maxUses),
						),
						or(
							isNull(WebsiteShopVouchers.expiresAt),
							gt(WebsiteShopVouchers.expiresAt, sql`NOW()`),
						),
					),
				);
			if (Number(result.affectedRows ?? 0) !== 1) return "exhausted";
			await tx.insert(WebsiteUsedShopVouchers).values({ userId, voucherId });
			return "ok";
		});
	} catch (error) {
		if (isDuplicateKey(error)) {
			return { ok: false, message: "You can only use each shop voucher once." };
		}
		return {
			ok: false,
			message: "We couldn't reach the server. Please try again.",
		};
	}
	if (claimed === "exhausted") {
		return {
			ok: false,
			message: "No active voucher with the given code was found.",
		};
	}

	// Grant the reward. The voucher carries a single amount, delivered as credits.
	try {
		await sendCurrency(
			{ rcon, db: currencyDb },
			userId,
			"credits",
			voucher.amount,
		);
	} catch {
		// sendCurrency already falls back to a direct DB write; if it still throws,
		// the used-row stands and the balance simply wasn't credited — surface that.
		return {
			ok: false,
			message:
				"Your voucher was accepted but the reward could not be delivered. Contact staff.",
		};
	}

	// The use was claimed above; expire the voucher once the cap is reached.
	try {
		const [updated] = await db
			.select({
				maxUses: WebsiteShopVouchers.maxUses,
				useCount: WebsiteShopVouchers.useCount,
			})
			.from(WebsiteShopVouchers)
			.where(eq(WebsiteShopVouchers.id, voucher.id))
			.limit(1);
		if (updated?.maxUses && updated.useCount >= updated.maxUses) {
			await db
				.update(WebsiteShopVouchers)
				.set({ expiresAt: new Date() })
				.where(eq(WebsiteShopVouchers.id, voucher.id));
		}
	} catch {
		// Reward already delivered; the counter bump is best-effort.
	}

	revalidatePath("/redeem");

	return {
		ok: true,
		message: `Success! Your balance has been increased by ${formatNumber(voucher.amount)} credits.`,
	};
}

/** A duplicate-key error, also when drizzle wraps the driver's error. */
function isDuplicateKey(err: unknown): boolean {
	for (let e = err; e && typeof e === "object"; ) {
		const { code, errno, cause } = e as {
			code?: string;
			errno?: number;
			cause?: unknown;
		};
		if (code === "ER_DUP_ENTRY" || errno === 1062) return true;
		e = cause;
	}
	return false;
}
