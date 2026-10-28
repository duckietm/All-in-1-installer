import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { getTranslations } from "next-intl/server";
import { env } from "@/env";
import { resolveHotelName } from "@/lib/hotel-name";
import { sendMail } from "@/lib/services/email";

// Stateless email verification with a time-limited HMAC token.
//
// Token format: `{issuedAtUnix}.{hmacHex}` where
//   hmac = HMAC-SHA256(secret, `${email}|${issuedAt}`)
// Tokens expire after TOKEN_TTL_MS (24h). Legacy forever-valid digests
// (bare 64-char hex) are rejected.

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Secret mixed into the HMAC. Requires at least one of APP_KEY or AUTH_SECRET. */
function verifySecret(): string {
	const secret = env.APP_KEY || env.AUTH_SECRET;
	if (!secret)
		throw new Error(
			"APP_KEY or AUTH_SECRET must be set for email verification",
		);
	return secret;
}

function sign(email: string, issuedAt: number): string {
	return createHmac("sha256", verifySecret())
		.update(`${email}|${issuedAt}`)
		.digest("hex");
}

/** Compute a fresh verification token for an email (lowercased + trimmed). */
export async function verificationToken(email: string): Promise<string> {
	const normalised = email.trim().toLowerCase();
	const issuedAt = Math.floor(Date.now() / 1000);
	return `${issuedAt}.${sign(normalised, issuedAt)}`;
}

/**
 * Constant-time check that `token` matches a non-expired HMAC for `email`.
 * Returns false on format/expiry/signature mismatch rather than throwing.
 */
export async function isValidVerificationToken(
	email: string,
	token: string,
): Promise<boolean> {
	if (!email || !token) return false;
	const normalised = email.trim().toLowerCase();

	const match = /^(\d+)\.([a-f0-9]{64})$/i.exec(token.trim());
	if (!match) return false; // also rejects legacy forever-valid digests

	const issuedAt = Number(match[1]);
	const sig = match[2]?.toLowerCase() ?? "";
	if (!Number.isFinite(issuedAt) || issuedAt <= 0) return false;

	const ageMs = Date.now() - issuedAt * 1000;
	if (ageMs < 0 || ageMs > TOKEN_TTL_MS) return false;

	const expected = sign(normalised, issuedAt);
	const a = Buffer.from(expected, "utf8");
	const b = Buffer.from(sig, "utf8");
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/**
 * Build the verification link + email and send it. No-ops gracefully when SMTP
 * is unconfigured (sendMail returns false).
 */
export async function sendVerification(email: string): Promise<boolean> {
	const normalised = email.trim().toLowerCase();
	if (!normalised) return false;

	const token = await verificationToken(normalised);
	const base = env.APP_URL.replace(/\/+$/, "");
	const link = `${base}/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(normalised)}`;

	const hotelName = await resolveHotelName();

	let subject = `Verify your email · ${hotelName}`;
	let heading = "Verify your email";
	let body = `Welcome to ${hotelName}! Confirm this email address to finish setting up your account.`;
	let button = "Verify email";
	let fallback =
		"If the button doesn't work, paste this link into your browser:";

	try {
		const t = await getTranslations("emails.verify");
		subject = t("subject", { hotel: hotelName });
		heading = t("heading");
		body = t("body", { hotel: hotelName });
		button = t("button");
		fallback = t("fallback");
	} catch {
		/* messages missing — keep English defaults */
	}

	const html = `
    <div style="font-family:sans-serif;line-height:1.5;color:#0f172a">
      <h2 style="margin:0 0 0.5rem">${escapeHtml(heading)}</h2>
      <p>${escapeHtml(body)}</p>
      <p style="margin:1.25rem 0">
        <a href="${link}"
           style="display:inline-block;padding:0.6rem 1.2rem;border-radius:8px;background:#eeb425;color:#1a1a2e;font-weight:700;text-decoration:none">
          ${escapeHtml(button)}
        </a>
      </p>
      <p style="color:#64748b;font-size:0.875rem">${escapeHtml(fallback)}</p>
      <p style="color:#64748b;font-size:0.875rem;word-break:break-all">${link}</p>
    </div>
  `.trim();

	return sendMail(normalised, subject, html);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
