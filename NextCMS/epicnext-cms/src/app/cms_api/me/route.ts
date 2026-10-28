// Public REST API — the currently signed-in user.
//
// Reads the NextAuth session, then re-queries users by the session id to
// return a safe field set (never password / auth_ticket / 2FA secrets / pincode
// / mail). Returns { user: null } only when unauthenticated or missing.

import { eq } from "drizzle-orm";
import { apiJson, apiUnavailable } from "@/lib/api";
import { auth } from "@/lib/auth";
import { sessionUserId } from "@/lib/auth/session-user";
import { db, User } from "@/lib/db";

export async function GET(_req: Request) {
	const session = await auth();
	const id = sessionUserId(session?.user?.id);
	if (!id) {
		return apiJson({ user: null });
	}

	try {
		const [user] = await db
			.select({
				id: User.id,
				username: User.username,
				look: User.look,
				motto: User.motto,
				rank: User.rank,
				credits: User.credits,
				pixels: User.pixels,
				points: User.points,
				gender: User.gender,
				online: User.online,
				accountCreated: User.accountCreated,
			})
			.from(User)
			.where(eq(User.id, id))
			.limit(1);

		if (!user) {
			return apiJson({ user: null });
		}

		return apiJson({
			user: {
				id: user.id,
				username: user.username,
				look: user.look,
				motto: user.motto,
				rank: user.rank,
				credits: user.credits,
				pixels: user.pixels,
				points: user.points,
				gender: user.gender,
				online: user.online === "1",
				accountCreated: user.accountCreated,
			},
		});
	} catch {
		return apiUnavailable("Account data is temporarily unavailable");
	}
}
