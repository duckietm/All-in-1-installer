"use server";

import {
	getLoginUser,
	isEmailUnverified,
	normalizeLoginInput,
	runDummyHashCheck,
	verifyLoginPassword,
} from "@/lib/auth/login-core";
import {
	clearLoginLockout,
	isLoginLocked,
	recordLoginFailure,
} from "@/lib/auth/login-lockout";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { captchaConfig, verifyCaptcha } from "@/lib/services/captcha";

export type PrecheckResult =
	| "ok"
	| "invalid"
	| "twofactor"
	| "unverified"
	| "captcha"
	| "locked";

/**
 * Validates username+password WITHOUT creating a session, and reports whether a
 * TOTP code is still required. Lets the login form do the two-step 2FA flow.
 * Also enforces captcha + optional email-verification when configured.
 */
export async function precheckLogin(
	username: string,
	password: string,
	captchaToken?: string | null,
): Promise<PrecheckResult> {
	const { username: u, password: p } = normalizeLoginInput(username, password);
	if (!u || !p) return "invalid";

	const ip = await clientIp();
	if (!(await rateLimit(`precheck:${ip}`, 10, 5 * 60_000)).ok) return "invalid";

	const cfg = await captchaConfig();
	if (cfg.provider !== "none") {
		if (!(await verifyCaptcha(captchaToken ?? null, ip))) return "captcha";
	}

	// A lockout must be checked BEFORE the password is verified: the success
	// path clears the counter, which would otherwise let an already-locked
	// account straight back in with the correct credentials.
	const user = await getLoginUser(u);
	if (!user) {
		// Prevent timing-based enumeration: always run a dummy hash check.
		await runDummyHashCheck(p);
		return "invalid";
	}

	if (await isLoginLocked(user.id)) return "locked";

	const res = await verifyLoginPassword(user, p);
	if (!res.valid) {
		await recordLoginFailure(user.id);
		return "invalid";
	}

	await clearLoginLockout(user.id);

	if (await isEmailUnverified(user)) {
		return "unverified";
	}

	return user.twoFactorConfirmedAt ? "twofactor" : "ok";
}
