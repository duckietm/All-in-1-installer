// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	allowed: new Set<string>(),
	queried: [] as unknown[],
}));
vi.mock("@/lib/api-handler", () => ({
	withAdmin:
		(_: unknown, handler: (...args: unknown[]) => unknown) =>
		(request: unknown) =>
			handler(request, {
				session: { user: { id: 1, rank: 7 } },
				permissions: { isSuperAdmin: false },
			}),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/permissions", async () => ({
	...(await import("@/lib/permission-slugs")),
	canAccess: (_: unknown, slug: string) => state.allowed.has(slug),
}));
vi.mock("@/lib/db", async () => {
	const tables = Object.fromEntries(
		[
			"User",
			"Rooms",
			"Guilds",
			"WebsiteArticles",
			"WebsiteRareValues",
			"WebsiteShopArticles",
		].map((name) => [
			name,
			{
				name,
				id: `${name}Id`,
				username: `${name}Name`,
				mail: `${name}Mail`,
				slug: `${name}Slug`,
				ownerName: `${name}Owner`,
				itemId: `${name}Item`,
				description: `${name}Description`,
			},
		]),
	);
	return {
		...tables,
		db: {
			select() {
				let table: unknown;
				const query = {
					from(value: unknown) {
						table = value;
						return query;
					},
					where() {
						return query;
					},
					orderBy() {
						return query;
					},
					async limit() {
						state.queried.push(table);
						return [{ id: 1, title: "Match", subtitle: "Data" }];
					},
				};
				return query;
			},
		},
	};
});

import { GET } from "@/app/api/admin/search/route";
import { PERMS } from "@/lib/permission-slugs";

beforeEach(() => {
	state.allowed.clear();
	state.queried.length = 0;
});
const request = () =>
	({
		nextUrl: new URL("https://test.invalid/api/admin/search?q=match"),
	}) as Parameters<typeof GET>[0];
it("does not query or expose categories without their view permission", async () => {
	const response = await GET(request(), {});
	expect((await response.json()).results).toEqual([]);
	expect(state.queried).toHaveLength(0);
});
it("searches only the permitted category", async () => {
	state.allowed.add(PERMS.NEWS_VIEW);
	const response = await GET(request(), {});
	const body = await response.json();
	expect(body.results).toHaveLength(1);
	expect(body.results[0].type).toBe("articles");
	expect(state.queried).toHaveLength(1);
});
