import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { cache } from "react";
import { env } from "@/env";
import { getCachedJwtVersion } from "@/lib/auth/jwt-version-cache";
import {
	getLoginUser,
	invalidateLoginCache,
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

export { invalidateLoginCache };

import { hasActiveBan } from "@/lib/auth/active-ban";
import { AUTH_BASE_PATH } from "@/lib/auth/base-path";
import { verify2faChallenge } from "@/lib/auth/twofactor-verification";
import { recordWebsiteLogin } from "@/lib/auth/website-login-log";
import { db, User } from "@/lib/db";
import { logger } from "@/lib/logger";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const nextAuth = NextAuth({
	basePath: AUTH_BASE_PATH,
	trustHost: true,
	secret: env.AUTH_SECRET,
	session: { strategy: "jwt", maxAge: 24 * 60 * 60 },
	pages: { signIn: "/login", error: "/login" },
	logger: {
		error(error) {
			logger.error("NextAuth error", {
				error: error.message,
				stack: error.stack,
			});
		},
	},
	providers: [
		Credentials({
			credentials: {
				username: { label: "Username", type: "text" },
				password: { label: "Password", type: "password" },
				code: { label: "2FA code", type: "text" },
			},
			authorize: async (credentials) => {
				const { username, password } = normalizeLoginInput(
					credentials?.username,
					credentials?.password,
				);
				if (!username || !password) return null;

				const ip = await clientIp();

				// Throttle login attempts per IP (10 per 5 min) against credential stuffing.
				if (!(await rateLimit(`login:${ip}`, 10, 5 * 60_000)).ok) return null;

				const user = await getLoginUser(username);
				if (!user) {
					// Prevent timing-based enumeration: always run a dummy hash check.
					await runDummyHashCheck(password);
					return null;
				}

				// Same per-account lockout the pre-check uses (same key and budget), so
				// the two paths cannot be used to buy extra attempts, and a client that
				// skips the pre-check is still bounded. Checked before the password is
				// verified — clearing on success would unlock a locked account.
				if (await isLoginLocked(user.id)) return null;

				const res = await verifyLoginPassword(user, password);
				if (!res.valid) {
					await recordLoginFailure(user.id);
					return null;
				}

				await clearLoginLockout(user.id);

				// A banned account gets no new session (banning also revokes the ones it has).
				if (await hasActiveBan(user.id)) return null;

				if (await isEmailUnverified(user)) {
					return null;
				}

				if (res.upgradedHash) {
					await db
						.update(User)
						.set({ password: res.upgradedHash })
						.where(eq(User.id, user.id));
					invalidateLoginCache(username);
				}

				// Two-factor: if enabled, a valid TOTP or recovery code is required.
				if (user.twoFactorConfirmedAt && user.twoFactorSecret) {
					const code = String(credentials?.code ?? "").trim();
					if (!code || !env.APP_KEY) return null;

					// Per-user 2FA rate limit (5 attempts per 30s) — prevents TOTP brute-force
					// even when the attacker rotates IPs or knows the password.
					if (!(await rateLimit(`2fa:${user.id}`, 5, 30_000)).ok) return null;

					if (!(await verify2faChallenge(user.id, code))) return null;
				}

				// Record the successful login for the user's "session logs" page.
				await recordWebsiteLogin(user.id, ip);

				const jwtVersion = await getCachedJwtVersion(user.id);
				return {
					id: String(user.id),
					name: user.username,
					rank: user.rank,
					jwtVersion,
				};
			},
		}),
	],
	callbacks: {
		async jwt({ token, user, account }) {
			if (user) {
				token.jwtVersion =
					(user as { jwtVersion?: number }).jwtVersion ?? token.jwtVersion ?? 0;
				token.jwtCheckedAt = Date.now();
			}

			if (user && account?.provider === "credentials") {
				token.rank = (user as { rank?: number }).rank;
				token.sub = String((user as { id?: string }).id);
				return token;
			}

			// Re-check jwt version at most once per minute (memory/Redis cached).
			if (token.sub && !token.invalid) {
				const lastCheck =
					typeof token.jwtCheckedAt === "number" ? token.jwtCheckedAt : 0;
				if (Date.now() - lastCheck >= 60_000) {
					try {
						const version = await getCachedJwtVersion(Number(token.sub));
						if (version === null || (token.jwtVersion ?? 0) !== version) {
							token.invalid = true;
							delete token.sub;
							return token;
						}
						token.jwtCheckedAt = Date.now();
					} catch {
						logger.warn("JWT version check failed, keeping session");
					}
				}
			}

			return token;
		},
		session({ session, token }) {
			if (token.invalid || !token.sub) {
				return session;
			}
			if (session.user) session.user.id = token.sub;
			if (typeof token.rank === "number" && session.user)
				session.user.rank = token.rank;
			return session;
		},
	},
});

export const { handlers, signOut } = nextAuth;

/**
 * `auth()` re-parses the session cookie, decodes and HMAC-verifies the JWT and
 * runs the `jwt`/`session` callbacks on every call. A single authenticated
 * render calls it from the access guard, the site layout, both permission
 * loaders and the page itself — 4-5 times on the critical path. React's
 * `cache` scopes the memo to the current request, so those all share one
 * verification. Outside a render (scripts, worker) it is a pass-through.
 */
export const auth = cache(nextAuth.auth);
