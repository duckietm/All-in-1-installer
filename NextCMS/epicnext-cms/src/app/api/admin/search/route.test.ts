import { MySqlDialect } from "drizzle-orm/mysql-core";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	select: vi.fn(),
	guard: vi.fn(),
	permissions: new Set<string>(),
	rateLimit: vi.fn(),
}));
vi.mock("@/lib/db", async () => ({
	...(await import("@/db/schema")),
	db: { select: mocks.select },
}));
vi.mock("@/lib/permissions", async () => ({
	...(await import("@/lib/permission-slugs")),
	canAccess: (permissions: { has: (slug: string) => boolean }, slug: string) =>
		permissions.has(slug),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/api-handler", () => ({
	withAdmin: (
		options: unknown,
		handler: (request: NextRequest, context: unknown) => Promise<Response>,
	) => {
		mocks.guard(options);
		return (request: NextRequest) =>
			handler(request, {
				session: { user: { id: 1, rank: 5 } },
				permissions: {
					isSuperAdmin: false,
					has: (slug: string) => mocks.permissions.has(slug),
				},
			});
	},
}));

import {
	CatalogPages,
	CatalogPagesBc,
	Guilds,
	ItemsBase,
	User,
	WebsiteArticles,
	WebsiteHelpCenterTickets,
	WebsiteTicket,
} from "@/lib/db";
import { PERMS } from "@/lib/permission-slugs";
import { emptyRouteContext } from "@/test/route-context";
import { GET } from "./route";

const calls: {
	table: unknown;
	fields: Record<string, unknown>;
	condition: unknown;
	limit: number;
}[] = [];
const dialect = new MySqlDialect();
const rows = new Map<unknown, unknown[]>();

beforeEach(() => {
	mocks.permissions.clear();
	mocks.rateLimit.mockResolvedValue({ ok: true });
	mocks.select.mockReset();
	rows.clear();
	calls.length = 0;
	mocks.select.mockImplementation((fields) => {
		const call = {
			table: undefined as unknown,
			fields,
			condition: undefined as unknown,
			limit: 0,
		};
		const builder = {
			from(table: unknown) {
				call.table = table;
				return builder;
			},
			where(condition: unknown) {
				call.condition = condition;
				return builder;
			},
			orderBy() {
				return builder;
			},
			limit(limit: number) {
				call.limit = limit;
				calls.push(call);
				return Promise.resolve(rows.get(call.table) ?? []);
			},
		};
		return builder;
	});
});

const search = (q: string) =>
	GET(
		new NextRequest(
			`https://cms.test/api/admin/search?q=${encodeURIComponent(q)}`,
		),
		emptyRouteContext(),
	);

describe("unified admin search", () => {
	it("requires the staff dashboard gate and performs no entity reads without category permission", async () => {
		expect(mocks.guard).toHaveBeenCalledWith({
			permission: PERMS.ADMIN_DASHBOARD,
		});
		expect(await (await search("chair")).json()).toEqual({
			ok: true,
			results: [],
			partial: false,
		});
		expect(mocks.select).not.toHaveBeenCalled();
	});
	it.each([
		[PERMS.USERS_VIEW, [User, Guilds]],
		[PERMS.NEWS_VIEW, [WebsiteArticles]],
		[PERMS.CATALOG_VIEW, [ItemsBase, CatalogPages, CatalogPagesBc]],
		[PERMS.TICKETS_VIEW, [WebsiteTicket, WebsiteHelpCenterTickets]],
	])("reads only categories granted by %s", async (permission, tables) => {
		mocks.permissions.add(permission);
		await search("chair");
		expect(calls.map((call) => call.table)).toEqual(tables);
		expect(calls.every((call) => call.limit === 5)).toBe(true);
	});
	it("returns exact detail destinations without private user or ticket fields", async () => {
		[PERMS.USERS_VIEW, PERMS.CATALOG_VIEW, PERMS.TICKETS_VIEW].forEach((p) => {
			mocks.permissions.add(p);
		});
		rows.set(User, [{ id: 12, title: "Alice" }]);
		rows.set(ItemsBase, [{ id: 12, title: "Chair", subtitle: "chair" }]);
		rows.set(CatalogPagesBc, [{ id: 12, title: "Chairs" }]);
		rows.set(WebsiteHelpCenterTickets, [{ id: 12n, title: "Help" }]);
		const payload = await (await search("12")).json();
		expect(payload.results.map((r: { url: string }) => r.url)).toEqual([
			"/admin/users/show/12",
			"/admin/items/12",
			"/admin/catalog/builder-club/12",
			"/admin/help-tickets/12",
		]);
		expect(calls.find((call) => call.table === User)?.fields).toEqual({
			id: User.id,
			title: User.username,
		});
		expect(
			calls.find((call) => call.table === WebsiteHelpCenterTickets)?.fields,
		).toEqual({
			id: WebsiteHelpCenterTickets.id,
			title: WebsiteHelpCenterTickets.title,
		});
	});
	it("ignores short queries and treats wildcard input literally", async () => {
		mocks.permissions.add(PERMS.USERS_VIEW);
		await search(" a ");
		expect(calls).toHaveLength(0);
		await search("_%");
		const query = dialect.sqlToQuery(
			calls[0].condition as Parameters<MySqlDialect["sqlToQuery"]>[0],
		);
		expect(query.params).toEqual(["%\\_\\%%"]);
		expect(query.sql).not.toContain("mail");
	});
	it("bounds oversized queries and rejects partial numeric identifiers", async () => {
		mocks.permissions.add(PERMS.USERS_VIEW);
		await search("a".repeat(200));
		expect(
			dialect.sqlToQuery(
				calls[0].condition as Parameters<MySqlDialect["sqlToQuery"]>[0],
			).params,
		).toEqual([`%${"a".repeat(64)}%`]);
		await search("12abc");
		expect(
			dialect.sqlToQuery(
				calls[2].condition as Parameters<MySqlDialect["sqlToQuery"]>[0],
			).params,
		).toEqual(["%12abc%"]);
	});
	it("supports one-digit identifiers", async () => {
		mocks.permissions.add(PERMS.USERS_VIEW);
		await search("1");
		expect(
			dialect.sqlToQuery(
				calls[0].condition as Parameters<MySqlDialect["sqlToQuery"]>[0],
			).params,
		).toEqual(["%1%", 1]);
	});
	it("reports a partial failure while retaining authorized results", async () => {
		mocks.permissions.add(PERMS.CATALOG_VIEW);
		rows.set(ItemsBase, [{ id: 12, title: "Chair", subtitle: "chair" }]);
		const implementation = mocks.select.getMockImplementation();
		mocks.select.mockImplementation((fields) => {
			const builder = implementation?.(fields);
			const originalFrom = builder.from;
			builder.from = (table: unknown) => {
				originalFrom(table);
				if (table === CatalogPagesBc)
					builder.limit = () => Promise.reject(new Error("missing table"));
				return builder;
			};
			return builder;
		});
		const payload = await (await search("chair")).json();
		expect(payload.partial).toBe(true);
		expect(payload.results).toHaveLength(1);
		expect(payload.results[0].url).toBe("/admin/items/12");
	});
	it("caps the combined results while retaining each requested category", async () => {
		[
			PERMS.USERS_VIEW,
			PERMS.NEWS_VIEW,
			PERMS.CATALOG_VIEW,
			PERMS.TICKETS_VIEW,
		].forEach((permission) => {
			mocks.permissions.add(permission);
		});
		[
			User,
			WebsiteArticles,
			ItemsBase,
			CatalogPages,
			CatalogPagesBc,
			WebsiteTicket,
			WebsiteHelpCenterTickets,
		].forEach((table) => {
			rows.set(
				table,
				Array.from({ length: 5 }, (_, index) => ({
					id: index + 1,
					title: "Match",
					subtitle: "Name",
				})),
			);
		});
		const payload = await (await search("Match")).json();
		expect(payload.results).toHaveLength(20);
		expect(
			new Set(payload.results.map((row: { type: string }) => row.type)),
		).toEqual(
			new Set(["users", "articles", "furniture", "catalog", "tickets"]),
		);
	});
	it("rate limits without reading records", async () => {
		mocks.permissions.add(PERMS.USERS_VIEW);
		mocks.rateLimit.mockResolvedValue({ ok: false, retryAfter: 20 });
		expect((await search("Alice")).status).toBe(429);
		expect(mocks.select).not.toHaveBeenCalled();
	});
});
