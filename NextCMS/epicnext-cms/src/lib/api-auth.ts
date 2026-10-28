import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import {
	type PersonalTokenAbility,
	tokenAllowsAbilities,
} from "@/lib/auth/personal-token-abilities";
import {
	personalTokenScope,
	USER_TOKENABLE_TYPE,
} from "@/lib/auth/personal-token-scope";
import { databaseUserId } from "@/lib/auth/session-user";
import { db, PersonalAccessTokens } from "@/lib/db";

/**
 * Bearer-token auth for the public REST API, backed by personal_access_tokens
 * (the Laravel Sanctum table that already exists in the emulator DB). Tokens are
 * stored as the sha256 of the plaintext; the client sends the plaintext (or the
 * Sanctum "{id}|{plaintext}" form) as `Authorization: Bearer …`.
 */
function hashToken(raw: string): string {
	return createHash("sha256").update(raw).digest("hex");
}

/** Resolve an authorized user token; callers without a declared scope require full access. */
export async function bearerUserId(
	req: Request,
	requiredAbilities: readonly PersonalTokenAbility[] = [],
): Promise<number | null> {
	const header = req.headers.get("authorization") ?? "";
	const m = header.match(/^Bearer\s+(.+)$/i);
	if (!m) return null;
	let raw = m[1].trim();
	const pipe = raw.indexOf("|");
	if (pipe >= 0) raw = raw.slice(pipe + 1); // Sanctum "{id}|{token}"
	if (!raw) return null;

	try {
		const [row] = await db
			.select({
				id: PersonalAccessTokens.id,
				tokenableId: PersonalAccessTokens.tokenableId,
				tokenableType: PersonalAccessTokens.tokenableType,
				abilities: PersonalAccessTokens.abilities,
			})
			.from(PersonalAccessTokens)
			.where(
				and(
					eq(PersonalAccessTokens.token, hashToken(raw)),
					eq(PersonalAccessTokens.tokenableType, USER_TOKENABLE_TYPE),
					or(
						isNull(PersonalAccessTokens.expiresAt),
						gt(PersonalAccessTokens.expiresAt, new Date()),
					),
				),
			)
			.limit(1);
		if (
			!row ||
			row.tokenableType !== USER_TOKENABLE_TYPE ||
			!tokenAllowsAbilities(row.abilities, requiredAbilities)
		)
			return null;
		const userId = databaseUserId(row.tokenableId);
		if (userId === null) return null;
		// Best-effort last-used stamp (don't fail the request if it errors).
		void db
			.update(PersonalAccessTokens)
			.set({ lastUsedAt: new Date() })
			.where(eq(PersonalAccessTokens.id, row.id))
			.catch(() => {});
		return userId;
	} catch {
		return null;
	}
}

/**
 * Mint a new token for a user. Returns the plaintext (shown once).
 *
 * New tokens get the narrow read/write set every client actually needs. The old
 * `abilities: ["*"]` meant a leaked token could call *any* endpoint, including
 * destructive ones; the wildcard is kept working for reading old rows so
 * existing integrations do not break.
 */
const DEFAULT_TOKEN_ABILITIES: PersonalTokenAbility[] = [
	"radio:read",
	"radio:write",
	"tickets:read",
	"tickets:write",
];

export async function issueToken(
	userId: number,
	name = "api",
): Promise<string | null> {
	const plaintext = randomBytes(32).toString("hex");
	const now = new Date();
	try {
		await db.insert(PersonalAccessTokens).values({
			...personalTokenScope(userId),
			name: name.slice(0, 100),
			token: hashToken(plaintext),
			abilities: JSON.stringify(DEFAULT_TOKEN_ABILITIES),
			createdAt: now,
			updatedAt: now,
		});
		return plaintext;
	} catch {
		return null;
	}
}
