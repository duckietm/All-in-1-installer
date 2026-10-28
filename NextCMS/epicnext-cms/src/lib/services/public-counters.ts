import "server-only";

import { and, count, eq, or, sql } from "drizzle-orm";
import { cached } from "@/lib/cache";
import { CameraWeb, db, Rooms, User, WebsiteArticles } from "@/lib/db";
import { ONLINE_COUNT_TTL_MS } from "@/lib/perf-ttls";

export { ONLINE_COUNT_TTL_MS };

/**
 * Row counters for the public homepage.
 *
 * These live in one place on purpose: the homepage and the boot warm-up both
 * populate the same cache keys, so two different implementations would race to
 * write different values into the same entry.
 */

/*
 * These are exact counts on purpose.
 *
 * `information_schema.TABLES.TABLE_ROWS` was tried here as a cheap stand-in,
 * because an exact COUNT(*) walks an index. Measured against the real database
 * it turned out to be pointless: `users` has 165 rows, `rooms` 92 and
 * `camera_web` 0, and the estimate was 0.00% off on all three. An index scan
 * over 165 rows costs less than the round trip the estimate would have saved,
 * while the estimate carries a real risk of displaying a plausible but wrong
 * member count — and InnoDB's accuracy degrades as a table grows. If these
 * tables ever reach six figures, revisit the trade; below that, exactness is
 * free.
 */

export async function countUsers(): Promise<number> {
	const [row] = await db.select({ total: count() }).from(User);
	return row?.total ?? 0;
}

export async function countRooms(): Promise<number> {
	const [row] = await db.select({ total: count() }).from(Rooms);
	return row?.total ?? 0;
}

export async function countPhotos(): Promise<number> {
	const [row] = await db.select({ total: count() }).from(CameraWeb);
	return row?.total ?? 0;
}

/**
 * Published articles only — the same filter `getNewsList` renders from, so the
 * "Articles" figure on the homepage can never disagree with the news section
 * that sits next to it.
 */
export async function countArticles(): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(WebsiteArticles)
		.where(
			and(
				eq(WebsiteArticles.status, "published"),
				or(
					sql`${WebsiteArticles.publishAt} IS NULL`,
					sql`${WebsiteArticles.publishAt} <= NOW()`,
				),
			),
		);
	return row?.total ?? 0;
}

/**
 * Online users is deliberately *not* estimated: it is read from an index over a
 * small subset of rows, it is the one counter people watch closely, and being a
 * few seconds behind looks broken rather than approximate.
 */
export async function countOnline(): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(User)
		.where(eq(User.online, "1"));
	return row?.total ?? 0;
}

// ── Shared hot read: online counter ───────────────────────────────────
//
// One function for every caller (homepage, login, register, headers, the client
// page and the warm-up). Each call site used to inline this, and the ones that
// omitted `staleMs` wrote an entry without a grace window, which made the key
// block on COUNT(*) at every TTL boundary. The TTL itself is env-tuned via
// perf-ttls (CMS_ONLINE_COUNT_TTL_SEC).
export async function cachedOnlineCount(): Promise<number> {
	return cached("online_count", ONLINE_COUNT_TTL_MS, countOnline, {
		staleMs: 15_000,
	});
}
