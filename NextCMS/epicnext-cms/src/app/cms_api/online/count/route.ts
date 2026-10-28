// Public REST API — count of currently-online users.
//
// `online` is the emulator's string flag "1" / "0" (see User model). Returns
// { count: 0 } (never 500) on DB failure.

import { count, eq } from "drizzle-orm";
import { apiJson, publicCacheControl } from "@/lib/api";
import { cached } from "@/lib/cache";
import { db, User } from "@/lib/db";

export async function GET(_req: Request) {
	try {
		// Polled by every page view and the in-game SSE stream, so a count that
		// is one interval behind is worthless as "wrong" but a blocking COUNT(*)
		// on each expiry is not. The grace window keeps the origin off the path.
		const result = await cached(
			"online_count",
			10_000,
			async () => {
				const [row] = await db
					.select({ total: count() })
					.from(User)
					.where(eq(User.online, "1"));
				return row?.total ?? 0;
			},
			{ staleMs: 15_000 },
		);
		return apiJson(
			{ count: result },
			{ headers: { "cache-control": publicCacheControl(10) } },
		);
	} catch {
		return apiJson({ count: 0 });
	}
}
