import "server-only";

import { asc, desc, eq, gte } from "drizzle-orm";
import { cached } from "@/lib/cache";
import { CameraWeb, db, User, WebsiteTeams } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
	CACHE_WARMUP_ENABLED,
	COUNTERS_TTL_MS,
	ONLINE_COUNT_TTL_MS,
} from "@/lib/perf-ttls";
import { apiCacheKey, redisCache } from "@/lib/redis-cache";
import { cachedHomePayload } from "@/lib/services/home-payload";
import { getNewsList } from "@/lib/services/news-list";
import {
	countArticles,
	countOnline,
	countPhotos,
	countRooms,
	countUsers,
} from "@/lib/services/public-counters";
import { siteSettings } from "@/lib/services/site-settings";

/**
 * Prime the hot public cache keys right after boot.
 *
 * Every deploy starts with an empty in-process cache, and any key that also
 * expired while the old process was down has to be recomputed from the database.
 * With no warm-up, the first visitor after each deploy pays for a burst of
 * simultaneous misses; with it, the site is already warm before traffic arrives.
 *
 * Warming works by cache *key*, not by call site: these use exactly the keys the
 * routes and pages read, so priming an entry serves every reader of it. Failures
 * are logged and ignored — a warm-up that cannot reach the database must never
 * stop the server from serving.
 */

const COUNTER_TTL_MS = COUNTERS_TTL_MS;
const ONLINE_TTL_MS = ONLINE_COUNT_TTL_MS;

async function warm<T>(name: string, load: () => Promise<T>): Promise<void> {
	try {
		await load();
	} catch (error) {
		logger.warn("[cache] warm-up failed", {
			key: name,
			error: String(error),
		});
	}
}

export async function warmPublicCaches(): Promise<void> {
	// Boot warm-up can be turned off per deploy (CMS_WARMUP_ENABLED=false): on
	// small hosts a burst of COUNT(*) queries right after boot competes with the
	// emulator for the same database.
	if (!CACHE_WARMUP_ENABLED) return;
	// Elke `warm` wordt afgewacht voordat de volgende begint, dus de COUNT(*)
	// queries gaan één voor één in plaats van als een burst op een database die
	// nog aan het opstarten is. Dat is goed genoeg; kunstmatige sleeps zouden
	// de warme start alleen maar vertragen zonder iets te winnen.
	await warm("online_count", () =>
		cached("online_count", ONLINE_TTL_MS, countOnline, { staleMs: 15_000 }),
	);
	await warm("total_users", () =>
		cached("total_users", COUNTER_TTL_MS, countUsers, {
			staleMs: COUNTER_TTL_MS,
		}),
	);
	await warm("total_rooms", () =>
		cached("total_rooms", COUNTER_TTL_MS, countRooms, {
			staleMs: COUNTER_TTL_MS,
		}),
	);
	await warm("total_photos", () =>
		cached("total_photos", COUNTER_TTL_MS, countPhotos, {
			staleMs: COUNTER_TTL_MS,
		}),
	);
	await warm("total_articles", () =>
		cached("total_articles", COUNTER_TTL_MS, countArticles, {
			staleMs: COUNTER_TTL_MS,
		}),
	);
	await warm("online_users", () =>
		cached("online_users", ONLINE_TTL_MS, () => listOnlineUsers(100), {
			staleMs: 15_000,
		}),
	);
	await warm("api:staff", () =>
		redisCache(apiCacheKey("staff"), 300, loadStaff, { staleMs: 300 }),
	);
	await warm("api:teams", () =>
		redisCache(apiCacheKey("teams"), 300, loadTeams, { staleMs: 600 }),
	);
	// Prime the real payload the route serves — a placeholder here used to be
	// cached under the shared key and served to every client after a restart.
	await warm("news:home", cachedHomePayload);
	await warm("news_list", () => getNewsList(4));
	// The homepage reads its own roster/photo keys, so priming only the counters
	// left the first visitor after a deploy paying for the sections anyway.
	await warm("home_online_users", () =>
		cached("home_online_users", 15_000, () => listOnlineUsers(12), {
			staleMs: 30_000,
		}),
	);
	await warm("home_recent_photos", () =>
		cached("home_recent_photos", 60_000, loadRecentPhotos, {
			staleMs: 120_000,
		}),
	);
}

async function loadRecentPhotos() {
	return db
		.select({ id: CameraWeb.id, url: CameraWeb.url })
		.from(CameraWeb)
		.orderBy(desc(CameraWeb.timestamp))
		.limit(4);
}

async function listOnlineUsers(limit: number) {
	return db
		.select({ id: User.id, username: User.username, look: User.look })
		.from(User)
		.where(eq(User.online, "1"))
		.limit(limit);
}

async function loadStaff() {
	const minStaffRank =
		Number(await siteSettings.get("min_staff_rank", "7")) || 7;
	return db
		.select({
			username: User.username,
			look: User.look,
			rank: User.rank,
			motto: User.motto,
		})
		.from(User)
		.where(gte(User.rank, minStaffRank))
		.orderBy(desc(User.rank), asc(User.username))
		.limit(100);
}

async function loadTeams() {
	return db
		.select({
			id: WebsiteTeams.id,
			rankName: WebsiteTeams.rankName,
			badge: WebsiteTeams.badge,
			jobDescription: WebsiteTeams.jobDescription,
			staffColor: WebsiteTeams.staffColor,
		})
		.from(WebsiteTeams)
		.where(eq(WebsiteTeams.hiddenRank, false))
		.orderBy(asc(WebsiteTeams.id));
}
