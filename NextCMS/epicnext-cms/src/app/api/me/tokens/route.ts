// Public REST API — manage the SIGNED-IN user's personal access tokens.
//
// GET    /api/me/tokens       — list the current user's tokens (id, name,
//                               lastUsedAt). The token hash is NEVER returned.
// DELETE /api/me/tokens?id=42 — revoke one of the current user's tokens.
//
// Auth is the NextAuth web session (auth()), not a Bearer token. Tokens belong
// to the user via personal_access_tokens.tokenable_id (a BigInt). NOTE: the live
// table has no expires_at column, so it is never read or written here.

import { and, desc, eq } from "drizzle-orm";
import { apiError, apiJson, apiUnavailable, positiveBigInt } from "@/lib/api";
import { auth } from "@/lib/auth";
import { personalTokenScope } from "@/lib/auth/personal-token-scope";
import { sessionUserId } from "@/lib/auth/session-user";
import { db, PersonalAccessTokens } from "@/lib/db";

async function currentUserId(): Promise<number | null> {
	const session = await auth();
	return sessionUserId(session?.user?.id);
}

export async function GET(_req: Request) {
	const id = await currentUserId();
	if (!id) return apiError("Unauthorized", 401);

	try {
		const scope = personalTokenScope(id);
		const tokens = await db
			.select({
				id: PersonalAccessTokens.id,
				name: PersonalAccessTokens.name,
				lastUsedAt: PersonalAccessTokens.lastUsedAt,
			})
			.from(PersonalAccessTokens)
			.where(
				and(
					eq(PersonalAccessTokens.tokenableId, scope.tokenableId),
					eq(PersonalAccessTokens.tokenableType, scope.tokenableType),
				),
			)
			.orderBy(desc(PersonalAccessTokens.id));
		// Never expose the token hash.
		return apiJson({ data: tokens });
	} catch {
		return apiUnavailable("Token data is temporarily unavailable");
	}
}

export async function DELETE(req: Request) {
	const id = await currentUserId();
	if (!id) return apiError("Unauthorized", 401);

	const tokenId = new URL(req.url).searchParams.get("id");
	const parsedTokenId = positiveBigInt(tokenId);
	if (!parsedTokenId) {
		return apiError("A valid token id is required", 422);
	}

	try {
		// Scope the delete to the owner so users cannot revoke others' tokens.
		const scope = personalTokenScope(id);
		const [result] = await db
			.delete(PersonalAccessTokens)
			.where(
				and(
					eq(PersonalAccessTokens.id, parsedTokenId),
					eq(PersonalAccessTokens.tokenableId, scope.tokenableId),
					eq(PersonalAccessTokens.tokenableType, scope.tokenableType),
				),
			);
		if (!result.affectedRows) {
			return apiError("Token not found", 404);
		}
		return apiJson({ ok: true });
	} catch {
		return apiUnavailable("Could not revoke token");
	}
}
