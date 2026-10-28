"use server";

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { env } from "@/env";
import { auth } from "@/lib/auth";
import { LaravelEncrypter } from "@/lib/auth/laravel-encrypter";
import { generateTotpSecret, verifyTotp } from "@/lib/auth/totp";
import { db, User } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

async function sessionUserId(): Promise<number> {
	const session = await auth();
	if (!session?.user?.id) redirect("/login");
	return Number(session.user.id);
}

function generateRecoveryCodes(): string[] {
	const codes: string[] = [];
	for (let i = 0; i < 8; i++) {
		codes.push(
			randomBytes(4)
				.toString("hex")
				.toUpperCase()
				.replace(/(.{4})/, "$1-"),
		);
	}
	return codes;
}

/** Verify a TOTP code OR a recovery code. Returns the updated recovery codes (minus used one) if a recovery code was used, or null on failure. */
async function verifyTwoFactorCode(
	userId: number,
	code: string,
): Promise<{ ok: boolean; updatedRecoveryCodes?: string | null }> {
	const [user] = await db
		.select({
			twoFactorSecret: User.twoFactorSecret,
			twoFactorRecoveryCodes: User.twoFactorRecoveryCodes,
		})
		.from(User)
		.where(eq(User.id, userId))
		.limit(1);
	if (!user?.twoFactorSecret) return { ok: false };

	// Try TOTP first
	try {
		const secret = new LaravelEncrypter(env.APP_KEY as string).decrypt(
			user.twoFactorSecret,
		);
		if (verifyTotp(code, secret)) return { ok: true };
	} catch {
		/* fall through to recovery */
	}

	// Try recovery codes
	if (user.twoFactorRecoveryCodes) {
		let codes: string[];
		try {
			codes = JSON.parse(user.twoFactorRecoveryCodes) as string[];
		} catch {
			codes = [];
		}
		const idx = codes.indexOf(code);
		if (idx !== -1) {
			codes.splice(idx, 1);
			const remaining = codes.length > 0 ? JSON.stringify(codes) : null;
			return { ok: true, updatedRecoveryCodes: remaining };
		}
	}

	return { ok: false };
}

/** Step 1: generate a secret and recovery codes, store encrypted but UNconfirmed. */
export async function beginTwoFactor(): Promise<void> {
	const id = await sessionUserId();
	if (!env.APP_KEY) redirect("/settings/2fa?error=noappkey");

	if (!(await rateLimit(`2fa-begin:${id}`, 5, 30_000)).ok)
		redirect("/settings/2fa?error=ratelimit");

	// Re-running this action while 2FA is confirmed would be a silent *downgrade*
	// (the new secret is stored unconfirmed, and unconfirmed means "login gate
	// off"), so the existing setup has to be disabled through the proper flow
	// first: a valid code, not just an authenticated session.
	const [current] = await db
		.select({ twoFactorConfirmedAt: User.twoFactorConfirmedAt })
		.from(User)
		.where(eq(User.id, id))
		.limit(1);
	if (current?.twoFactorConfirmedAt)
		redirect("/settings/2fa?error=alreadyenabled");

	const secret = generateTotpSecret();
	const encrypted = new LaravelEncrypter(env.APP_KEY).encrypt(secret);
	const codes = generateRecoveryCodes();
	await db
		.update(User)
		.set({
			twoFactorSecret: encrypted,
			twoFactorConfirmedAt: null,
			twoFactorRecoveryCodes: JSON.stringify(codes),
		})
		.where(eq(User.id, id));
	revalidatePath("/settings/2fa");
}

/** Step 2: verify a code against the pending secret, then confirm and show recovery codes. */
export async function confirmTwoFactor(formData: FormData): Promise<void> {
	const id = await sessionUserId();
	if (!env.APP_KEY) redirect("/settings/2fa?error=noappkey");

	if (!(await rateLimit(`2fa-confirm:${id}`, 5, 30_000)).ok)
		redirect("/settings/2fa?error=ratelimit");

	const code = String(formData.get("code") ?? "")
		.normalize("NFC")
		.trim();

	const { ok, updatedRecoveryCodes } = await verifyTwoFactorCode(id, code);
	if (!ok) redirect("/settings/2fa?error=badcode");

	// A recovery code spends itself on use, so persist the remainder together
	// with the confirmation instead of dropping the caller's own update.
	await db
		.update(User)
		.set({
			twoFactorConfirmedAt: new Date(),
			...(updatedRecoveryCodes !== undefined
				? { twoFactorRecoveryCodes: updatedRecoveryCodes }
				: {}),
		})
		.where(eq(User.id, id));
	redirect("/settings/2fa?enabled=1");
}

export async function disableTwoFactor(formData: FormData): Promise<void> {
	const id = await sessionUserId();
	if (!env.APP_KEY) redirect("/settings/2fa?error=noappkey");

	if (!(await rateLimit(`2fa-disable:${id}`, 5, 30_000)).ok)
		redirect("/settings/2fa?error=ratelimit");

	const code = String(formData.get("code") ?? "")
		.normalize("NFC")
		.trim();

	const { ok } = await verifyTwoFactorCode(id, code);
	if (!ok) redirect("/settings/2fa?error=badcode");

	await db
		.update(User)
		.set({
			twoFactorSecret: null,
			twoFactorRecoveryCodes: null,
			twoFactorConfirmedAt: null,
		})
		.where(eq(User.id, id));
	redirect("/settings/2fa?disabled=1");
}
