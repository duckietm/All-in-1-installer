import { cached } from "@/lib/cache";
import { PUBLIC_SEARCH_TTL_MS } from "@/lib/perf-ttls";
import { publicReadFailure } from "@/lib/services/public-read";
import "server-only";
import { and, asc, count, eq, inArray, like, or } from "drizzle-orm";
import { db, Rooms, User, WebsiteEvent } from "@/lib/db";
import { cacheSafe } from "@/lib/redis-cache";
import { loadNewsArchive } from "@/lib/services/news-archive";

/**
 * A leading-wildcard LIKE cannot use an index, so every search section costs a
 * COUNT(*) scan plus an ordered page fetch. Repeated queries are common enough
 * (nav links, back-navigation, the same popular terms from many visitors) to be
 * worth a short cache. The window is deliberately short: this is a live
 * directory, and a user who registers or a room that opens should show up
 * without waiting.
 */
const SEARCH_TTL_MS = PUBLIC_SEARCH_TTL_MS;

function pageNumber(value: number | undefined, total: number) {
	return Math.min(
		Math.max(1, Math.ceil(total / 12)),
		Number.isFinite(value) ? Math.max(1, Math.trunc(value ?? 1)) : 1,
	);
}

/**
 * Sections are cached independently so one slow query cannot hold up the rest,
 * and so a failure stays a failure instead of being cached as a result.
 */
function searchKey(section: string, query: string, page: number | undefined) {
	const requested = Number.isFinite(page) ? Math.trunc(page ?? 1) : 1;
	return `search:${section}:${requested}:${query}`;
}

export async function loadPublicSearch(options: {
	query: string;
	usersPage?: number;
	roomsPage?: number;
	newsPage?: number;
	eventsPage?: number;
}) {
	const query = (typeof options.query === "string" ? options.query : "")
		.trim()
		.slice(0, 191);
	if (!query) return null;
	const userWhere = like(User.username, `%${query}%`);
	const roomWhere = and(
		like(Rooms.name, `%${query}%`),
		eq(Rooms.state, "open"),
	);
	const eventWhere = and(
		inArray(WebsiteEvent.status, ["published", "completed"]),
		or(
			like(WebsiteEvent.title, `%${query}%`),
			like(WebsiteEvent.description, `%${query}%`),
		),
	);
	const [users, rooms, news, events] = await Promise.allSettled([
		cached(
			searchKey("users", query, options.usersPage),
			SEARCH_TTL_MS,
			async () => {
				const [{ value: total }] = await db
					.select({ value: count() })
					.from(User)
					.where(userWhere);
				const page = pageNumber(options.usersPage, Number(total));
				const rows = await db
					.select({
						id: User.id,
						username: User.username,
						look: User.look,
						online: User.online,
					})
					.from(User)
					.where(userWhere)
					.orderBy(asc(User.username), asc(User.id))
					.limit(12)
					.offset((page - 1) * 12);
				return cacheSafe({
					rows,
					total: Number(total),
					page,
					lastPage: Math.max(1, Math.ceil(Number(total) / 12)),
				});
			},
		),
		cached(
			searchKey("rooms", query, options.roomsPage),
			SEARCH_TTL_MS,
			async () => {
				const [{ value: total }] = await db
					.select({ value: count() })
					.from(Rooms)
					.where(roomWhere);
				const page = pageNumber(options.roomsPage, Number(total));
				const rows = await db
					.select({
						id: Rooms.id,
						name: Rooms.name,
						ownerName: Rooms.ownerName,
						users: Rooms.users,
						usersMax: Rooms.usersMax,
					})
					.from(Rooms)
					.where(roomWhere)
					.orderBy(asc(Rooms.name), asc(Rooms.id))
					.limit(12)
					.offset((page - 1) * 12);
				return cacheSafe({
					rows,
					total: Number(total),
					page,
					lastPage: Math.max(1, Math.ceil(Number(total) / 12)),
				});
			},
		),
		loadNewsArchive({ search: query, page: options.newsPage }),
		cached(
			searchKey("events", query, options.eventsPage),
			SEARCH_TTL_MS,
			async () => {
				const [{ value: total }] = await db
					.select({ value: count() })
					.from(WebsiteEvent)
					.where(eventWhere);
				const page = pageNumber(options.eventsPage, Number(total));
				const rows = await db
					.select({
						id: WebsiteEvent.id,
						title: WebsiteEvent.title,
						startsAt: WebsiteEvent.startsAt,
					})
					.from(WebsiteEvent)
					.where(eventWhere)
					.orderBy(asc(WebsiteEvent.startsAt), asc(WebsiteEvent.id))
					.limit(12)
					.offset((page - 1) * 12);
				// cacheSafe() turns startsAt into an ISO string for both cache
				// paths; the page formats it with toISOString(), so revive it
				// here to keep that call valid on a cache hit too.
				const cachedResult = cacheSafe({
					rows,
					total: Number(total),
					page,
					lastPage: Math.max(1, Math.ceil(Number(total) / 12)),
				});
				return {
					...cachedResult,
					rows: cachedResult.rows.map((row) => ({
						...row,
						startsAt: new Date(row.startsAt),
					})),
				};
			},
		),
	]);
	for (const [section, result] of Object.entries({
		users,
		rooms,
		news,
		events,
	})) {
		if (result.status === "rejected")
			publicReadFailure(`search.${section}`)(result.reason);
	}
	return { query, users, rooms, news, events };
}
