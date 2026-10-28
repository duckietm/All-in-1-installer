"use server";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { env } from "@/env";
import { invalidateLoginCache } from "@/lib/auth/login-core";
import { hashPassword } from "@/lib/auth/password";
import { passwordPolicy } from "@/lib/auth/password-policy";
import { revokeUserCredentials } from "@/lib/auth/session-revocation";
import { db, PasswordReset, User } from "@/lib/db";
import { logger } from "@/lib/logger";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { logServerError } from "@/lib/server-log";
import { captchaConfig, verifyCaptcha } from "@/lib/services/captcha";
import { sendMail } from "@/lib/services/email";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function sha256(s: string): string {
	return createHash("sha256").update(s).digest("hex");
}

/**
 * Back to the reset form with a *code*, never with the human-readable message:
 * a raw `?error=` value would be rendered on our own domain, which is a
 * perfect phishing skeleton. The page maps each code to a translation.
 */
function errorRedirect(email: string, token: string, code: string): never {
	return redirect(
		`/reset?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}&error=${code}`,
	);
}

export async function requestReset(formData: FormData): Promise<void> {
	const email = String(formData.get("email") ?? "")
		.normalize("NFC")
		.trim()
		.toLowerCase();

	const ip = await clientIp();

	// CAPTCHA when a provider is configured (mirrors register).
	const cfg = await captchaConfig();
	if (cfg.provider !== "none") {
		const token = String(formData.get(cfg.field) ?? "").normalize("NFC");
		if (!(await verifyCaptcha(token, ip))) {
			redirect("/forgot?error=captcha");
		}
	}

	// Throttle reset requests per IP (3 per 15 min) to curb email-bomb abuse.
	const allowed = (await rateLimit(`reset:${ip}`, 3, 15 * 60_000)).ok;

	// Always respond the same way so we don't reveal which emails exist.
	if (allowed && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
		try {
			// The column's collation is accent-insensitive, so `victim@gmaíl.com` would match
			// `victim@gmail.com` and the link would go to the attacker's look-alike domain:
			// only exact addresses count.
			const matches = (
				await db
					.select({ id: User.id, mail: User.mail })
					.from(User)
					.where(eq(User.mail, email))
					.orderBy(asc(User.id))
			).filter((m) => sameAddress(m.mail, email));
			if (matches.length > 1) {
				logger.warn("Password reset address is not unique", {
					email,
					accountCount: matches.length,
					using: matches[0]?.id,
				});
			}
			const user = matches[0];
			if (user) {
				// Duplicate addresses exist on legacy databases; resetting the
				// *oldest* account keeps the choice deterministic instead of
				// "whatever row the engine returns first".
				const token = randomBytes(32).toString("hex");
				const hashed = sha256(token);
				const createdAt = new Date();
				await db
					.insert(PasswordReset)
					.values({ email, token: hashed, createdAt })
					.onDuplicateKeyUpdate({ set: { token: hashed, createdAt } });
				const link = `${env.APP_URL}/reset?email=${encodeURIComponent(email)}&token=${token}`;
				await sendMail(
					email,
					`${env.HOTEL_NAME} — password reset`,
					`<p>Click to reset your password (valid 1 hour):</p><p><a href="${link}">${link}</a></p>`,
				);
			}
		} catch {
			// swallow — generic response below
		}
	}

	redirect("/forgot?sent=1");
}

export async function resetPassword(formData: FormData): Promise<void> {
	const email = String(formData.get("email") ?? "")
		.normalize("NFC")
		.trim()
		.toLowerCase();
	const token = String(formData.get("token") ?? "")
		.normalize("NFC")
		.trim();
	const password = String(formData.get("password") ?? "").normalize("NFC");

	// Throttle reset attempts per IP (5 per 15 min) to prevent token brute-force.
	if (!(await rateLimit(`resetpwd:${await clientIp()}`, 5, 15 * 60_000)).ok) {
		redirect(errorRedirect(email, token, "ratelimit"));
	}

	let error: "password" | "invalid" | "failed" | null = null;
	if (
		password.length < passwordPolicy.minLength ||
		password.length > passwordPolicy.maxLength
	)
		error = "password";

	if (!error) {
		try {
			const [row] = await db
				.select({
					token: PasswordReset.token,
					createdAt: PasswordReset.createdAt,
				})
				.from(PasswordReset)
				.where(eq(PasswordReset.email, email))
				.limit(1);
			const fresh = row?.createdAt
				? Date.now() - row.createdAt.getTime() < TOKEN_TTL_MS
				: false;
			const a = Buffer.from(sha256(token), "hex");
			const b = row ? Buffer.from(row.token, "hex") : Buffer.alloc(a.length);
			const match =
				row != null && a.length === b.length && timingSafeEqual(a, b);

			if (!row || !fresh || !match) {
				error = "invalid";
			} else {
				const matches = (
					await db
						.select({ id: User.id, mail: User.mail, username: User.username })
						.from(User)
						.where(eq(User.mail, email))
						.orderBy(asc(User.id))
				).filter((m) => sameAddress(m.mail, email));
				const user = matches[0];
				if (!user) {
					error = "invalid";
				} else {
					const newHash = await hashPassword(password);
					// A password change has to end every existing session: the
					// popular reason for resetting is a compromised account, and a
					// stolen cookie/API token must not outlive the reset.
					await Promise.all([
						db
							.update(User)
							.set({ password: newHash })
							.where(eq(User.id, user.id)),
						revokeUserCredentials(user.id),
					]);
					// The login cache is keyed by username: the old hash must not keep working.
					await invalidateLoginCache(user.username);
					await db
						.delete(PasswordReset)
						.where(eq(PasswordReset.email, email))
						.catch((error) =>
							logServerError("password.reset_delete_tokens_failed", error, {
								email,
							}),
						);
				}
			}
		} catch {
			error = "failed";
		}
	}

	if (error) {
		redirect(errorRedirect(email, token, error));
	}
	redirect("/login?reset=1");
}

/** The exact address (ignoring only case), not what the database collation considers equal. */
function sameAddress(
	stored: string | null | undefined,
	typed: string,
): boolean {
	return (stored ?? "").normalize("NFC").trim().toLowerCase() === typed;
}
