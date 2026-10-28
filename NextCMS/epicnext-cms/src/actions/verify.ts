"use server";

import { eq } from "drizzle-orm";
import { sendVerification } from "@/lib/auth/email-verification";
import { db, User } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { captchaConfig, verifyCaptcha } from "@/lib/services/captcha";

export interface ResendVerificationState {
	ok: boolean;
	error: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Re-send a verification e-mail for an address the visitor typed on /verify.
 *
 * Deliberately reports success even when no matching unverified account exists:
 * a distinct failure would let anyone probe which addresses are registered. The
 * identical-privacy behaviour also applies to the e-mail templates, which are
 * only sent for real accounts. Rate limiting plus captcha are the spam defence:
 * this endpoint triggers real outbound mail, so an unverified address must not
 * be usable as a free mail cannon.
 */
export async function resendVerification(
	_prevState: ResendVerificationState,
	formData: FormData,
): Promise<ResendVerificationState> {
	const email = String(formData.get("email") ?? "")
		.normalize("NFC")
		.trim()
		.toLowerCase();
	if (!EMAIL_RE.test(email)) {
		return { ok: false, error: "invalid" };
	}

	const ip = await clientIp();
	if (!(await rateLimit(`verify:resend:${ip}`, 3, 10 * 60_000)).ok) {
		return { ok: false, error: "rateLimited" };
	}
	// Same cooldown keyed on the address, so rotating IPs cannot be used to
	// mail-bomb an arbitrary inbox with "verify your email".
	if (!(await rateLimit(`verify:resend:email:${email}`, 3, 10 * 60_000)).ok) {
		return { ok: false, error: "rateLimited" };
	}

	// Captcha runs before any lookup or send, and answers with the same
	// `captcha` code the login form uses so the UI can point at the widget.
	const cfg = await captchaConfig();
	if (cfg.provider !== "none") {
		const token = String(formData.get(cfg.field) ?? "")
			.normalize("NFC")
			.trim();
		if (!(await verifyCaptcha(token || null, ip))) {
			return { ok: false, error: "captcha" };
		}
	}

	try {
		const [user] = await db
			.select({ id: User.id, mailVerified: User.mailVerified })
			.from(User)
			.where(eq(User.mail, email))
			.limit(1);
		if (user && user.mailVerified !== "1") {
			await sendVerification(email);
		}
	} catch {
		return { ok: false, error: "unavailable" };
	}

	return { ok: true, error: null };
}
