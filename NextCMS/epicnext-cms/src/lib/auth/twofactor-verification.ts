import { eq } from "drizzle-orm";

import { env } from "@/env";
import { LaravelEncrypter } from "@/lib/auth/laravel-encrypter";
import { verifyTotp } from "@/lib/auth/totp";
import { db, User } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Verifies a 2FA challenge (TOTP or one of the remaining recovery codes). TOTP
 * is tried first; on any decrypt/verify failure the recovery codes are used.
 * Consumes a used recovery code by removing it from the stored array.
 */
export async function verify2faChallenge(
	userId: number,
	code: string,
): Promise<boolean> {
	const [user] = await db
		.select({
			twoFactorSecret: User.twoFactorSecret,
			twoFactorRecoveryCodes: User.twoFactorRecoveryCodes,
		})
		.from(User)
		.where(eq(User.id, userId))
		.limit(1);
	if (!user?.twoFactorSecret) return false;

	// Try TOTP first.
	try {
		const appKey = env.APP_KEY;
		if (!appKey) throw new Error("APP_KEY not configured");
		const secret = new LaravelEncrypter(appKey).decrypt(user.twoFactorSecret);
		if (verifyTotp(code, secret)) return true;
	} catch {
		logger.warn(
			"2FA TOTP verification failed, falling through to recovery codes",
		);
	}

	// Try recovery codes.
	if (user.twoFactorRecoveryCodes) {
		let codes: string[];
		try {
			codes = JSON.parse(user.twoFactorRecoveryCodes) as string[];
		} catch {
			logger.warn("Failed to parse 2FA recovery codes JSON");
			return false;
		}
		const idx = codes.indexOf(code);
		if (idx !== -1) {
			codes.splice(idx, 1);
			const remaining = codes.length > 0 ? JSON.stringify(codes) : null;
			await db
				.update(User)
				.set({ twoFactorRecoveryCodes: remaining })
				.where(eq(User.id, userId));
			return true;
		}
	}

	return false;
}
