// Public REST API — list of currently-online users (username + look only).
//
// `online` is stored by the emulator as the string "1" / "0" (see User model).
// Capped at 100 rows. Returns empty data (never 500) on DB failure.

import { eq } from "drizzle-orm";
import { apiJson, publicCacheControl } from "@/lib/api";
import { cached } from "@/lib/cache";
import { db, User } from "@/lib/db";

export async function GET(_req: Request) {
	try {
		// A briefly stale online list is harmless; blocking the first request
		// after the TTL on a COUNT + SELECT is not.
		const users = await cached(
			"online_users",
			10_000,
			async () =>
				db
					.select({ username: User.username, look: User.look })
					.from(User)
					.where(eq(User.online, "1"))
					.limit(100),
			{ staleMs: 15_000 },
		);

		return apiJson(
			{ users },
			{ headers: { "cache-control": publicCacheControl(10) } },
		);
	} catch {
		return apiJson({ users: [] });
	}
}
