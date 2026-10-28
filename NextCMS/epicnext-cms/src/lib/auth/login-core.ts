import { sql } from "drizzle-orm";
import { checkLogin } from "@/lib/auth/password";
import { cachedQuery, invalidateKey } from "@/lib/cached-db";
import { queryRows } from "@/lib/db";
import { siteSettings } from "@/lib/services/site-settings";

export interface LoginUser {
	id: number;
	username: string;
	password: string | null;
	rank: number;
	mail: string | null;
	mailVerified: string | null;
	twoFactorConfirmedAt: string | null;
	twoFactorSecret: string | null;
}

/**
 * Fixed dummy bcrypt hash used to keep timing roughly constant when a username
 * does not exist, so attackers can't enumerate accounts by response time.
 */
const DUMMY_BCRYPT_HASH =
	"$2y$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZabcd";

/**
 * Normalize credentials exactly like the registration flow hashes them, so
 * accounts with accented/non-ASCII usernames or passwords verify correctly.
 */
export function normalizeLoginInput(username: unknown, password: unknown) {
	return {
		username: String(username ?? "")
			.normalize("NFC")
			.trim(),
		password: String(password ?? "").normalize("NFC"),
	};
}

/**
 * Cached login user lookup — short TTL to survive brute-force attempts
 * while still reflecting recent password/account changes reasonably fast.
 */
export async function getLoginUser(
	username: string,
): Promise<LoginUser | null> {
	return cachedQuery<LoginUser | null>(
		`login:user:${username}`,
		async () => {
			const rows = await queryRows<{
				id: number;
				username: string;
				password: string | null;
				rank: number;
				mail: string | null;
				mail_verified: string | null;
				two_factor_confirmed_at: string | null;
				two_factor_secret: string | null;
			}>(sql`
				SELECT id, username, password, rank, mail,
				       mail_verified,
				       two_factor_confirmed_at,
				       two_factor_secret
				FROM users
				WHERE username = ${username}
				LIMIT 1
			`);
			return rows.length > 0
				? {
						id: rows[0].id,
						username: rows[0].username,
						password: rows[0].password,
						rank: rows[0].rank,
						mail: rows[0].mail,
						mailVerified: rows[0].mail_verified,
						twoFactorConfirmedAt: rows[0].two_factor_confirmed_at,
						twoFactorSecret: rows[0].two_factor_secret,
					}
				: null;
		},
		15, // 15s TTL — brute-force protection without blocking legit changes
	);
}

/** Call after password reset / rank change to invalidate the cached login row. */
export async function invalidateLoginCache(username: string): Promise<void> {
	await invalidateKey(`login:user:${username}`);
}

/** Runs a dummy hash check so missing-user responses stay timing-constant. */
export async function runDummyHashCheck(password: string): Promise<void> {
	await checkLogin(password, DUMMY_BCRYPT_HASH);
}

/** Verifies the password against the stored hash and reports a possible upgrade. */
export async function verifyLoginPassword(
	user: LoginUser,
	password: string,
): Promise<{ valid: boolean; upgradedHash?: string }> {
	if (!user.password) return { valid: false };
	return checkLogin(password, user.password);
}

/** True when email verification is required but this account hasn't verified yet. */
export async function isEmailUnverified(user: LoginUser): Promise<boolean> {
	return (
		(await siteSettings.getBool("require_email_verification", false)) &&
		!!user.mail &&
		user.mailVerified !== "1"
	);
}
