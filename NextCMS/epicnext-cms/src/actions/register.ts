"use server";

import { count, eq } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { sendVerification } from "@/lib/auth/email-verification";
import { hashPassword } from "@/lib/auth/password";
import { passwordPolicy } from "@/lib/auth/password-policy";
import { DEFAULT_AVATAR_FIGURE } from "@/lib/avatar-figure";
import { invalidateKey } from "@/lib/cached-db";
import { db, User } from "@/lib/db";
import { logger } from "@/lib/logger";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { captchaConfig, verifyCaptcha } from "@/lib/services/captcha";
import { checkVpn } from "@/lib/services/ip-lookup";
import { recordReferral } from "@/lib/services/referrals";
import { siteSettings } from "@/lib/services/site-settings";

// Reserved usernames that can never be registered (prevent impersonation/admin confusion).
const RESERVED_USERNAMES = new Set([
	"admin",
	"root",
	"system",
	"moderator",
	"mod",
	"staff",
	"support",
	"help",
	"service",
	"api",
	"webmaster",
	"postmaster",
	"hostmaster",
	"administrator",
	"superuser",
	"sysadmin",
	"nobody",
	"anonymous",
	"guest",
	"default",
	"test",
	"demo",
	"example",
	"info",
	"security",
	"abuse",
	"noreply",
	"donotreply",
	"bot",
	"crawler",
	"indexer",
]);

// Disposable/temporary email domains (subset, expandable via settings).
const DISPOSABLE_EMAIL_DOMAINS = new Set([
	"10minutemail.com",
	"guerrillamail.com",
	"mailinator.com",
	"tempmail.com",
	"throwawaymail.com",
	"yopmail.com",
	"trashmail.com",
	"fakeinbox.com",
	"spamgourmet.com",
	"getnada.com",
	"maildrop.cc",
]);

function isReservedUsername(username: string): boolean {
	const lower = username.toLowerCase();
	if (RESERVED_USERNAMES.has(lower)) return true;
	if (
		lower.startsWith("admin") ||
		lower.startsWith("mod") ||
		lower.startsWith("staff")
	)
		return true;
	if (/^(x|www|mail|ftp|smtp|pop|imap|dns|ns[0-9]*)$/.test(lower)) return true;
	return false;
}

function hasDisposableEmailDomain(email: string): boolean {
	const domain = email.split("@")[1]?.toLowerCase();
	return domain ? DISPOSABLE_EMAIL_DOMAINS.has(domain) : false;
}

// Rendered into the schema below and mapped back to a locale-independent code
// via `ZOD_MESSAGE_CODES`, so the length always reflects the configured policy.
const PASSWORD_MIN_MESSAGE = `Password must be at least ${passwordPolicy.minLength} characters`;
const PASSWORD_MAX_MESSAGE = "Password is too long";

const registerSchema = z
	.object({
		username: z
			.string()
			.min(3, "Username must be at least 3 characters")
			.max(25, "Username must be at most 25 characters")
			.regex(
				/^[A-Za-z0-9_-]+$/,
				"Username may only contain letters, numbers, underscore and hyphen",
			)
			.refine((u) => !isReservedUsername(u), "This username is reserved"),
		mail: z
			.string()
			.email("Enter a valid email address")
			.optional()
			.or(z.literal(""))
			.refine(
				(e) => !e || !hasDisposableEmailDomain(e),
				"Temporary email domains are not allowed",
			),
		password: z
			.string()
			.min(passwordPolicy.minLength, PASSWORD_MIN_MESSAGE)
			.max(passwordPolicy.maxLength, PASSWORD_MAX_MESSAGE)
			.regex(/[A-Z]/, "Password must contain at least one uppercase letter")
			.regex(/[a-z]/, "Password must contain at least one lowercase letter")
			.regex(/[0-9]/, "Password must contain at least one digit")
			.regex(
				/[^A-Za-z0-9]/,
				"Password must contain at least one special character",
			), // Added special character requirement
		passwordConfirmation: z.string(),
		look: z.string().optional(),
	})
	.refine((data) => data.password === data.passwordConfirmation, {
		message: "Passwords do not match",
		path: ["passwordConfirmation"],
	});

/**
 * Stable, locale-independent reason for a failed sign-up. The client maps these
 * onto `pages.register.<code>` so the form speaks the visitor's language; the
 * English `error` string stays as a fallback and for API/log consumers.
 */
export type RegisterErrorCode =
	| "usernameMinLength"
	| "usernameMaxLength"
	| "usernamePattern"
	| "usernameReserved"
	| "usernameTaken"
	| "emailValid"
	| "emailDisposable"
	| "passwordMinLength"
	| "passwordMaxLength"
	| "passwordUpper"
	| "passwordLower"
	| "passwordDigit"
	| "passwordSpecial"
	| "passwordsMatch"
	| "termsRequired"
	| "captchaFailed"
	| "rateLimited"
	| "vpnBlocked"
	| "maxAccountsPerIp"
	| "unavailable"
	| "createFailed"
	| "invalidInput";

/** Maps the schema's English messages onto locale-independent codes. */
const ZOD_MESSAGE_CODES: Record<string, RegisterErrorCode> = {
	"Username must be at least 3 characters": "usernameMinLength",
	"Username must be at most 25 characters": "usernameMaxLength",
	"Username may only contain letters, numbers, underscore and hyphen":
		"usernamePattern",
	"This username is reserved": "usernameReserved",
	"Enter a valid email address": "emailValid",
	"Temporary email domains are not allowed": "emailDisposable",
	[PASSWORD_MIN_MESSAGE]: "passwordMinLength",
	[PASSWORD_MAX_MESSAGE]: "passwordMaxLength",
	"Password must contain at least one uppercase letter": "passwordUpper",
	"Password must contain at least one lowercase letter": "passwordLower",
	"Password must contain at least one digit": "passwordDigit",
	"Password must contain at least one special character": "passwordSpecial",
	"Passwords do not match": "passwordsMatch",
};

// A valid starter Habbo figure so the avatar renders in-client immediately.
// Shared with the imager URL builder, which normalises malformed stored looks
// to the same figure (the hair part needs a colour slot: `hr-100-1`, not
// `hr-100-`).
const DEFAULT_LOOK = DEFAULT_AVATAR_FIGURE;

export interface RegisterState {
	error: string | null;
	ok: boolean;
	/** Locale-independent reason, present on every failure. */
	code?: RegisterErrorCode;
}

export async function register(
	_prevState: RegisterState,
	formData: FormData,
): Promise<RegisterState> {
	const fail = (error: string, code: RegisterErrorCode): RegisterState => ({
		error,
		ok: false,
		code,
	});
	const raw = {
		username: String(formData.get("username") ?? "")
			.normalize("NFC")
			.trim(),
		mail: String(formData.get("mail") ?? "")
			.normalize("NFC")
			.trim()
			.toLowerCase(),
		password: String(formData.get("password") ?? "").normalize("NFC"),
		passwordConfirmation: String(
			formData.get("password_confirmation") ?? "",
		).normalize("NFC"),
		look:
			String(formData.get("look") ?? "")
				.normalize("NFC")
				.trim() || DEFAULT_LOOK,
		termsAccepted: formData.get("terms") === "on",
	};

	const parsed = registerSchema.safeParse(raw);
	if (!parsed.success) {
		const message = parsed.error.issues[0]?.message ?? "Invalid input";
		return fail(message, ZOD_MESSAGE_CODES[message] ?? "invalidInput");
	}

	const { username, mail, password, look } = parsed.data;
	const hasEmail = !!mail;
	const ip = await clientIp();

	// Throttle sign-ups per IP (5 per 10 minutes) to curb account spam.
	if (!(await rateLimit(`register:${ip}`, 5, 10 * 60_000)).ok) {
		return fail(
			"Too many sign-up attempts. Please wait a few minutes and try again.",
			"rateLimited",
		);
	}

	// CAPTCHA (Turnstile / reCAPTCHA) — only enforced when configured in settings.
	const cfg = await captchaConfig();
	if (cfg.provider !== "none") {
		const token = String(formData.get(cfg.field) ?? "").normalize("NFC");
		if (!(await verifyCaptcha(token, ip)))
			return fail(
				"Captcha verification failed. Please try again.",
				"captchaFailed",
			);
	}

	// Terms acceptance check.
	if (!raw.termsAccepted)
		return fail(
			"You must accept the terms and conditions to register.",
			"termsRequired",
		);

	// VPN/proxy block (only when enabled in /admin/vpn).
	if ((await checkVpn(ip)).blocked) {
		return fail(
			(await siteSettings.get("vpn_block_message", "")) ||
				"Registrations from VPN/proxy connections are not allowed.",
			"vpnBlocked",
		);
	}

	// Max accounts per IP (0 / unset = unlimited), mirrors AtomCMS.
	const max = Number(await siteSettings.get("max_accounts_per_ip", "0")) || 0;
	if (max > 0) {
		const [row] = await db
			.select({ total: count() })
			.from(User)
			.where(eq(User.ipRegister, ip))
			.catch(() => [{ total: 0 }]);
		if (Number(row?.total ?? 0) >= max)
			return fail(
				"You have reached the maximum number of accounts for your connection.",
				"maxAccountsPerIp",
			);
	}

	// Uniqueness check.
	try {
		const [existing] = await db
			.select({ id: User.id })
			.from(User)
			.where(eq(User.username, username))
			.limit(1);
		if (existing)
			return fail("That username is already taken", "usernameTaken");
	} catch {
		logger.warn("Username uniqueness check failed during registration");
		return fail("Registration is temporarily unavailable", "unavailable");
	}

	const now = Math.floor(Date.now() / 1000);
	let inviteeId = 0;
	try {
		const [result] = await db.insert(User).values({
			username,
			password: await hashPassword(password),
			mail: hasEmail ? mail : null,
			accountCreated: now,
			ipRegister: ip,
			ipCurrent: ip,
			look,
			termsAccepted: raw.termsAccepted,
		});
		inviteeId = Number(result.insertId);
	} catch (err) {
		const code = (err as { cause?: { code?: string } }).cause?.code;
		if (code === "ER_DUP_ENTRY") {
			return fail("That username is already taken", "usernameTaken");
		}
		logger.error("Account creation failed", {
			code,
			message: err instanceof Error ? err.message : String(err),
		});
		return fail(
			"Could not create the account. Please try again or contact staff.",
			"createFailed",
		);
	}

	// The login lookup is cached for 15s — drop any stale entry so the
	// immediate auto sign-in sees the fresh row.
	await invalidateKey(`login:user:${username}`);

	// Referral attribution (`/register?ref=<username>`). Best-effort: a broken
	// referral must never fail the account creation.
	if (inviteeId > 0) {
		const invitedBy = String(formData.get("ref") ?? "")
			.normalize("NFC")
			.trim();
		if (invitedBy) {
			await recordReferral({
				inviterUsername: invitedBy,
				inviteeId,
				inviteeIp: ip,
			});
		}
	}

	// Verification email must never block the sign-up response — it is sent
	// after the response is flushed (no-op when mail is unconfigured).
	if (hasEmail) {
		after(async () => {
			try {
				await sendVerification(mail);
			} catch {
				logger.warn("Failed to send verification email after registration");
			}
		});
	}

	// Client auto signs in with these credentials and navigates to /me.
	return { error: null, ok: true };
}
