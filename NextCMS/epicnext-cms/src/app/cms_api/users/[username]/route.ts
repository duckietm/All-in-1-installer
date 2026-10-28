// Public REST API — single user profile by username.
//
// AtomCMS exposed read-only profile JSON for the game site / external
// integrations. Mirrors the same safe field set selected by the public profile
// page (src/app/u/[username]/page.tsx). Never exposes password / auth_ticket /
// 2FA secrets / pincode / mail.

import { eq } from "drizzle-orm";
import { apiJson } from "@/lib/api";
import { db, User } from "@/lib/db";
import { apiCacheKey, cacheSafe, redisCache } from "@/lib/redis-cache";

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ username: string }> },
) {
	const { username } = await params;

	try {
		const user = await redisCache(
			apiCacheKey(`users:${username}`),
			30,
			async () => {
				const [row] = await db
					.select({
						id: User.id,
						username: User.username,
						look: User.look,
						motto: User.motto,
						rank: User.rank,
						credits: User.credits,
						online: User.online,
						accountCreated: User.accountCreated,
					})
					.from(User)
					.where(eq(User.username, username))
					.limit(1);

				if (!row) {
					return null;
				}

				// Wallet / online visibility are per-user settings; the public API
				// used to hand both out unconditionally, which made bulk scraping
				// of hidden wallets possible.
				const { loadProfilePrivacy } = await import(
					"@/lib/services/profile-privacy"
				);
				const privacy = await loadProfilePrivacy(row.id);

				return cacheSafe({
					username: row.username,
					look: row.look,
					motto: row.motto,
					rank: row.rank,
					credits: privacy.values.wallet ? row.credits : null,
					online: privacy.values.online ? row.online === "1" : null,
					accountCreated: row.accountCreated,
				});
			},
		);

		if (!user) {
			return apiJson({ error: "User not found" }, { status: 404 });
		}

		return apiJson(user);
	} catch {
		// DB unreachable — behave as "not found" rather than 500.
		return apiJson({ error: "User not found" }, { status: 404 });
	}
}
