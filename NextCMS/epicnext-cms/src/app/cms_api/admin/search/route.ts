import { asc, eq, like, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ADMIN_NAV_GROUPS, navItemIsAllowed } from "@/lib/admin-nav";
import { apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import {
	CatalogPages,
	CatalogPagesBc,
	db,
	Guilds,
	ItemsBase,
	Rooms,
	User,
	WebsiteArticles,
	WebsiteHelpCenterTickets,
	WebsiteRareValues,
	WebsiteShopArticles,
	WebsiteTicket,
} from "@/lib/db";
import { canAccess, PERMS } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
export type AdminSearchResult = {
	type: string;
	id: number | string;
	title: string;
	subtitle: string;
	url: string;
};
const PER_TYPE = 5;
const MAX_TOTAL = 20;
const MAX_QUERY_LENGTH = 64;
/** Escape LIKE wildcards so user input can't widen the match. */
function escapeLike(input: string): string {
	return input.replace(/[\\%_]/g, (m) => `\\${m}`);
}
export const GET = withAdmin(
	{ permission: PERMS.ADMIN_DASHBOARD },
	async (request, context) => {
		const limited = await rateLimit(
			`admin-search:${context.session.user.id}`,
			30,
			60_000,
		);
		if (!limited.ok) {
			return NextResponse.json(
				{ ok: false, error: "Too many requests" },
				{ status: 429, headers: { "retry-after": String(limited.retryAfter) } },
			);
		}
		const q = (request.nextUrl.searchParams.get("q") || "")
			.trim()
			.slice(0, MAX_QUERY_LENGTH);
		if (q.length < 2 && !/^[1-9]$/.test(q)) {
			return apiOk({ results: [] });
		}
		const canSearch = (href: string) => {
			const item = ADMIN_NAV_GROUPS.flatMap((group) => group.items).find(
				(item) => item.href === href,
			);
			return (
				!!item &&
				navItemIsAllowed(item, {
					isSuperAdmin: context.permissions.isSuperAdmin,
					has: (slug) =>
						canAccess(context.permissions, slug, context.session.user.rank),
				})
			);
		};
		const pattern = `%${escapeLike(q)}%`;
		const idExact = Number.parseInt(q, 10);
		const hasId =
			Number.isSafeInteger(idExact) && idExact > 0 && String(idExact) === q;
		let partial = false;
		const [
			users,
			articles,
			rooms,
			guilds,
			shopArticles,
			rareValues,
			furniture,
			catalog,
			catalogBc,
			tickets,
			helpTickets,
		] = await Promise.all([
			canSearch("/admin/users")
				? db
						.select({
							id: User.id,
							title: User.username,
						})
						.from(User)
						.where(
							or(
								like(User.username, pattern),
								...(hasId ? [eq(User.id, idExact)] : []),
							),
						)
						.orderBy(asc(User.id))
						.limit(PER_TYPE)
						.catch(() => {
							partial = true;
							return [];
						})
				: Promise.resolve([]),
			canSearch("/admin/articles")
				? db
						.select({
							id: WebsiteArticles.id,
							title: WebsiteArticles.title,
							subtitle: WebsiteArticles.slug,
						})
						.from(WebsiteArticles)
						.where(
							or(
								like(WebsiteArticles.title, pattern),
								like(WebsiteArticles.slug, pattern),
							),
						)
						.orderBy(asc(WebsiteArticles.id))
						.limit(PER_TYPE)
						.catch(() => {
							partial = true;
							return [];
						})
				: Promise.resolve([]),
			canSearch("/admin/rooms")
				? db
						.select({
							id: Rooms.id,
							title: Rooms.name,
							subtitle: Rooms.ownerName,
						})
						.from(Rooms)
						.where(
							or(
								like(Rooms.name, pattern),
								...(hasId ? [eq(Rooms.id, idExact)] : []),
							),
						)
						.orderBy(asc(Rooms.id))
						.limit(PER_TYPE)
						.catch(() => {
							partial = true;
							return [];
						})
				: Promise.resolve([]),
			canSearch("/admin/guilds")
				? db
						.select({
							id: Guilds.id,
							title: Guilds.name,
							subtitle: Guilds.description,
						})
						.from(Guilds)
						.where(
							or(
								like(Guilds.name, pattern),
								...(hasId ? [eq(Guilds.id, idExact)] : []),
							),
						)
						.orderBy(asc(Guilds.id))
						.limit(PER_TYPE)
						.catch(() => {
							partial = true;
							return [];
						})
				: Promise.resolve([]),
			canSearch("/admin/shop")
				? db
						.select({
							id: WebsiteShopArticles.id,
							title: WebsiteShopArticles.name,
							subtitle: WebsiteShopArticles.info,
						})
						.from(WebsiteShopArticles)
						.where(
							or(
								like(WebsiteShopArticles.name, pattern),
								...(hasId ? [eq(WebsiteShopArticles.id, BigInt(idExact))] : []),
							),
						)
						.orderBy(asc(WebsiteShopArticles.id))
						.limit(PER_TYPE)
						.catch(() => {
							partial = true;
							return [];
						})
				: Promise.resolve([]),
			canSearch("/admin/rare-values")
				? db
						.select({
							id: WebsiteRareValues.id,
							title: WebsiteRareValues.name,
							subtitle: WebsiteRareValues.itemId,
						})
						.from(WebsiteRareValues)
						.where(
							or(
								like(WebsiteRareValues.name, pattern),
								...(hasId ? [eq(WebsiteRareValues.itemId, idExact)] : []),
							),
						)
						.orderBy(asc(WebsiteRareValues.id))
						.limit(PER_TYPE)
						.catch(() => {
							partial = true;
							return [];
						})
				: Promise.resolve([]),
			canAccess(
				context.permissions,
				PERMS.CATALOG_VIEW,
				context.session.user.rank,
			)
				? db
						.select({
							id: ItemsBase.id,
							title: ItemsBase.publicName,
							subtitle: ItemsBase.itemName,
						})
						.from(ItemsBase)
						.where(
							or(
								like(ItemsBase.publicName, pattern),
								like(ItemsBase.itemName, pattern),
								...(hasId ? [eq(ItemsBase.id, idExact)] : []),
							),
						)
						.orderBy(asc(ItemsBase.id))
						.limit(PER_TYPE)
						.catch(() => {
							partial = true;
							return [];
						})
				: Promise.resolve([]),
			canAccess(
				context.permissions,
				PERMS.CATALOG_VIEW,
				context.session.user.rank,
			)
				? db
						.select({ id: CatalogPages.id, title: CatalogPages.caption })
						.from(CatalogPages)
						.where(
							or(
								like(CatalogPages.caption, pattern),
								...(hasId ? [eq(CatalogPages.id, idExact)] : []),
							),
						)
						.orderBy(asc(CatalogPages.id))
						.limit(PER_TYPE)
						.catch(() => {
							partial = true;
							return [];
						})
				: Promise.resolve([]),
			canAccess(
				context.permissions,
				PERMS.CATALOG_VIEW,
				context.session.user.rank,
			)
				? db
						.select({ id: CatalogPagesBc.id, title: CatalogPagesBc.caption })
						.from(CatalogPagesBc)
						.where(
							or(
								like(CatalogPagesBc.caption, pattern),
								...(hasId ? [eq(CatalogPagesBc.id, idExact)] : []),
							),
						)
						.orderBy(asc(CatalogPagesBc.id))
						.limit(PER_TYPE)
						.catch(() => {
							partial = true;
							return [];
						})
				: Promise.resolve([]),
			canAccess(
				context.permissions,
				PERMS.TICKETS_VIEW,
				context.session.user.rank,
			)
				? db
						.select({ id: WebsiteTicket.id, title: WebsiteTicket.subject })
						.from(WebsiteTicket)
						.where(
							or(
								like(WebsiteTicket.subject, pattern),
								...(hasId ? [eq(WebsiteTicket.id, idExact)] : []),
							),
						)
						.orderBy(asc(WebsiteTicket.id))
						.limit(PER_TYPE)
						.catch(() => {
							partial = true;
							return [];
						})
				: Promise.resolve([]),
			canAccess(
				context.permissions,
				PERMS.TICKETS_VIEW,
				context.session.user.rank,
			)
				? db
						.select({
							id: WebsiteHelpCenterTickets.id,
							title: WebsiteHelpCenterTickets.title,
						})
						.from(WebsiteHelpCenterTickets)
						.where(
							or(
								like(WebsiteHelpCenterTickets.title, pattern),
								...(hasId
									? [eq(WebsiteHelpCenterTickets.id, BigInt(idExact))]
									: []),
							),
						)
						.orderBy(asc(WebsiteHelpCenterTickets.id))
						.limit(PER_TYPE)
						.catch(() => {
							partial = true;
							return [];
						})
				: Promise.resolve([]),
		]);
		const groupMap: Record<
			string,
			{ type: string; items: Array<AdminSearchResult> }
		> = {
			furniture: { type: "furniture", items: [] },
			catalog: { type: "catalog", items: [] },
			tickets: { type: "tickets", items: [] },
			users: { type: "users", items: [] },
			articles: { type: "articles", items: [] },
			rooms: { type: "rooms", items: [] },
			guilds: { type: "guilds", items: [] },
			shop: { type: "shop", items: [] },
			rareValues: { type: "rareValues", items: [] },
		};
		for (const r of users) {
			groupMap.users.items.push({
				type: "users",
				id: r.id,
				title: r.title,
				subtitle: `#${r.id}`,
				url: `/admin/users/show/${r.id}`,
			});
		}
		for (const r of articles) {
			groupMap.articles.items.push({
				type: "articles",
				id: Number(r.id),
				title: r.title,
				subtitle: r.subtitle,
				url: `/admin/articles/${r.id}`,
			});
		}
		for (const r of rooms) {
			groupMap.rooms.items.push({
				type: "rooms",
				id: r.id,
				title: r.title || `Room #${r.id}`,
				subtitle: r.subtitle || "",
				url: `/admin/rooms/${r.id}`,
			});
		}
		for (const r of guilds) {
			groupMap.guilds.items.push({
				type: "guilds",
				id: r.id,
				title: r.title || `Guild #${r.id}`,
				subtitle: r.subtitle || "",
				url: `/admin/guilds/${r.id}`,
			});
		}
		for (const r of shopArticles) {
			groupMap.shop.items.push({
				type: "shop",
				id: Number(r.id),
				title: r.title,
				subtitle: r.subtitle || "",
				url: `/admin/shop/${r.id}`,
			});
		}
		for (const r of rareValues) {
			groupMap.rareValues.items.push({
				type: "rareValues",
				id: Number(r.id),
				title: r.title,
				subtitle: r.subtitle != null ? `Item #${r.subtitle}` : "",
				url: `/admin/rare-values/${r.id}`,
			});
		}
		for (const r of furniture) {
			groupMap.furniture.items.push({
				type: "furniture",
				id: r.id,
				title: r.title || r.subtitle || `#${r.id}`,
				subtitle: `${r.subtitle || ""} · #${r.id}`,
				url: `/admin/items/${r.id}`,
			});
		}
		for (const [rows, kind] of [
			[catalog, "normal"],
			[catalogBc, "bc"],
		] as const) {
			for (const r of rows)
				groupMap.catalog.items.push({
					type: "catalog",
					id: `${kind}-${r.id}`,
					title: r.title || `#${r.id}`,
					subtitle: kind === "bc" ? `BC · #${r.id}` : `#${r.id}`,
					url:
						kind === "bc"
							? `/admin/catalog/builder-club/${r.id}`
							: `/admin/catalog/${r.id}`,
				});
		}
		for (const r of tickets)
			groupMap.tickets.items.push({
				type: "tickets",
				id: `cms-${r.id}`,
				title: r.title,
				subtitle: `#${r.id}`,
				url: `/admin/tickets/${r.id}`,
			});
		for (const r of helpTickets)
			groupMap.tickets.items.push({
				type: "tickets",
				id: `help-${r.id}`,
				title: r.title,
				subtitle: `#${r.id}`,
				url: `/admin/help-tickets/${r.id}`,
			});
		const results: AdminSearchResult[] = [];
		const order = [
			"users",
			"furniture",
			"catalog",
			"tickets",
			"articles",
			"rooms",
			"guilds",
			"shop",
			"rareValues",
		];
		// Round-robin so no single type starves the others when capped.
		for (let i = 0; results.length < MAX_TOTAL; i++) {
			let added = false;
			for (const key of order) {
				const item = groupMap[key]?.items[i];
				if (item && results.length < MAX_TOTAL) {
					results.push(item);
					added = true;
				}
			}
			if (!added) break;
		}
		return apiOk({ results, partial });
	},
);
