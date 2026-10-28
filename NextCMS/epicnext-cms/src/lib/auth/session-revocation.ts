import { and, eq, sql } from "drizzle-orm";
import { invalidateJwtVersionCache } from "@/lib/auth/jwt-version-cache";
import { personalTokenScope } from "@/lib/auth/personal-token-scope";
import { db, PersonalAccessTokens, User } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Kill every live credential for a user: CMS JWTs (by bumping
 * `website_jwt_version`, which the `jwt` callback re-checks), the game SSO
 * ticket, and the API bearer tokens.
 *
 * Needed by sign-out-everywhere *and* by every password change: without it,
 * resetting a compromised password leaves the attacker's stolen session
 * cookie and API token working until they expire on their own.
 */
export async function revokeUserCredentials(userId: number): Promise<void> {
	try {
		await db
			.update(User)
			.set({
				websiteJwtVersion: sql`${User.websiteJwtVersion} + 1`,
				authTicket: "",
			})
			.where(eq(User.id, userId));
		await invalidateJwtVersionCache(userId);
	} catch (err) {
		logger.warn("Failed to revoke CMS session", {
			userId,
			error: err instanceof Error ? err.message : "Unknown",
		});
	}

	// Revoke API bearer tokens (Sanctum / personal_access_tokens).
	try {
		const scope = personalTokenScope(userId);
		await db
			.delete(PersonalAccessTokens)
			.where(
				and(
					eq(PersonalAccessTokens.tokenableId, scope.tokenableId),
					eq(PersonalAccessTokens.tokenableType, scope.tokenableType),
				),
			);
	} catch (err) {
		logger.warn("Failed to revoke personal access tokens", {
			userId,
			error: err instanceof Error ? err.message : "Unknown",
		});
	}
}
