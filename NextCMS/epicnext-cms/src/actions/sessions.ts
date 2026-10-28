"use server";

import { and, eq, sql } from "drizzle-orm";
import { auth, signOut } from "@/lib/auth";
import { invalidateJwtVersionCache } from "@/lib/auth/jwt-version-cache";
import { personalTokenScope } from "@/lib/auth/personal-token-scope";
import { db, PersonalAccessTokens, User } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Invalidate every CMS JWT for the signed-in user by bumping website_jwt_version,
 * revoke personal access tokens, revoke the game SSO ticket, then end the
 * current browser session too.
 */
export async function signOutEverywhere(): Promise<void> {
	const session = await auth();
	const userId = Number(session?.user?.id);
	if (!Number.isInteger(userId) || userId <= 0) {
		await signOut({ redirectTo: "/login" });
		return;
	}

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
		logger.warn("Failed to bump JWT version during sign-out-everywhere", {
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
		logger.warn(
			"Failed to revoke personal access tokens during sign-out-everywhere",
			{
				userId,
				error: err instanceof Error ? err.message : "Unknown",
			},
		);
	}

	await signOut({ redirectTo: "/login?signedOutAll=1" });
}

/**
 * Log the current user out of the website AND revoke their game SSO ticket.
 *
 * Without revoking it, a ticket leaked via logs/history/referrers stays valid
 * for the emulator after logout. Clearing the ticket makes any future client
 * connection with it invalid.
 */
export async function signOutAndRevokeTicket(): Promise<void> {
	const session = await auth();
	const userId = Number(session?.user?.id);
	if (Number.isInteger(userId) && userId > 0) {
		try {
			await db.update(User).set({ authTicket: "" }).where(eq(User.id, userId));
		} catch (err) {
			logger.warn("Failed to revoke SSO ticket during sign out", {
				userId,
				error: err instanceof Error ? err.message : "Unknown",
			});
		}
	}
	await signOut({ redirectTo: "/" });
}
