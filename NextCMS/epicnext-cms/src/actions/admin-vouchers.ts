"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { positiveBigInt } from "@/lib/api";
import { db, WebsiteShopVouchers } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import {
	type ActionResult,
	actionError,
	actionOk,
} from "@/lib/safe-action-shared";
import { logServerError } from "@/lib/server-log";

export async function createVoucher(input: {
	code: string;
	amount: number;
	maxUses: number;
	expiresAt?: string;
}): Promise<ActionResult<{ id: string }>> {
	await requirePermission(PERMS.SHOP_EDIT);

	const code = String(input.code ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	const amount = Number(input.amount);
	const maxUsesRaw = Number(input.maxUses);
	const maxUses =
		Number.isFinite(maxUsesRaw) && maxUsesRaw > 0 ? Math.floor(maxUsesRaw) : 1;

	if (!code || !(amount > 0)) {
		return actionError("Code and a positive amount are required");
	}

	let expiresAt: Date | null = null;
	const expiresRaw = String(input.expiresAt ?? "")
		.normalize("NFC")
		.trim();
	if (expiresRaw) {
		const parsed = new Date(expiresRaw);
		if (!Number.isNaN(parsed.getTime())) expiresAt = parsed;
	}

	const now = new Date();

	try {
		const [result] = await db.insert(WebsiteShopVouchers).values({
			code,
			amount: Math.floor(amount),
			maxUses,
			useCount: 0,
			expiresAt,
			createdAt: now,
			updatedAt: now,
		});
		revalidatePath("/admin/vouchers");
		return actionOk({ id: String(result.insertId) });
	} catch (error) {
		logServerError("admin.voucher_create_failed", error);
		return actionError("Could not create voucher (code may already exist)");
	}
}

export async function deleteVoucher(input: {
	id: string;
}): Promise<ActionResult> {
	await requirePermission(PERMS.SHOP_EDIT);

	const id = positiveBigInt(String(input.id ?? "").trim());
	if (!id) return actionError("Missing voucher id");

	try {
		await db.delete(WebsiteShopVouchers).where(eq(WebsiteShopVouchers.id, id));
		revalidatePath("/admin/vouchers");
		return actionOk();
	} catch (error) {
		logServerError("admin.voucher_delete_failed", error, {
			voucherId: String(id),
		});
		return actionError("Could not delete voucher");
	}
}

export async function updateVoucher(input: {
	id: string;
	code: string;
	amount: number;
	maxUses: number;
	expiresAt?: string;
}): Promise<ActionResult> {
	await requirePermission(PERMS.SHOP_EDIT);

	const id = positiveBigInt(String(input.id ?? "").trim());
	if (!id) return actionError("Missing voucher id");

	const code = String(input.code ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	const amount = Number(input.amount);
	const maxUsesRaw = Number(input.maxUses);
	const maxUses =
		Number.isFinite(maxUsesRaw) && maxUsesRaw > 0 ? Math.floor(maxUsesRaw) : 1;

	if (!code || !(amount > 0)) {
		return actionError("Code and a positive amount are required");
	}

	let expiresAt: Date | null = null;
	const expiresRaw = String(input.expiresAt ?? "")
		.normalize("NFC")
		.trim();
	if (expiresRaw) {
		const parsed = new Date(expiresRaw);
		if (!Number.isNaN(parsed.getTime())) expiresAt = parsed;
	}

	try {
		await db
			.update(WebsiteShopVouchers)
			.set({
				code,
				amount: Math.floor(amount),
				maxUses,
				expiresAt,
				updatedAt: new Date(),
			})
			.where(eq(WebsiteShopVouchers.id, id));
		revalidatePath("/admin/vouchers");
		return actionOk();
	} catch (error) {
		logServerError("admin.voucher_update_failed", error, {
			voucherId: String(id),
		});
		return actionError("Could not update voucher (code may already exist)");
	}
}
