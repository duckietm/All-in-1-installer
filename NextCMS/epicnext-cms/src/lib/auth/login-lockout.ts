import { clearRateLimit, peekRateLimit, rateLimit } from "@/lib/rate-limit";

/**
 * Per-account login lockout.
 *
 * The pre-existing limits were keyed on the client IP, so a distributed attack
 * — or simply a botnet — could grind on a single account indefinitely. This one
 * is keyed on the resolved account id, which is what actually needs protecting.
 *
 * Keying on the id (rather than the submitted string) is deliberate: users may
 * sign in with either their username or their e-mail, and neither `getLoginUser`
 * nor `normalizeLoginInput` fold case. Keying on the input would hand an
 * attacker a fresh budget for every spelling of the same account.
 */

/** Failed attempts tolerated before an account locks. */
export const LOGIN_MAX_ATTEMPTS = 8;
/** How long a failure stays on the record. */
export const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60_000;

function lockoutKey(userId: number): string {
	return `login-fail:${userId}`;
}

/**
 * Whether this account is currently locked. Read-only: the caller must not
 * have to consume an attempt just to find out.
 */
export async function isLoginLocked(userId: number): Promise<boolean> {
	return !(
		await peekRateLimit(
			lockoutKey(userId),
			LOGIN_MAX_ATTEMPTS,
			LOGIN_LOCKOUT_WINDOW_MS,
		)
	).ok;
}

/** Record a failed attempt. Resolves true when this failure trips the lockout. */
export async function recordLoginFailure(userId: number): Promise<boolean> {
	return !(
		await rateLimit(
			lockoutKey(userId),
			LOGIN_MAX_ATTEMPTS,
			LOGIN_LOCKOUT_WINDOW_MS,
		)
	).ok;
}

/** Forget the account's failures after a successful authentication. */
export async function clearLoginLockout(userId: number): Promise<void> {
	await clearRateLimit(lockoutKey(userId));
}
