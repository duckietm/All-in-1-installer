// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	queries: [] as { sql: string; params: unknown[] }[],
	failUsers: false,
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { drizzle } = await import("drizzle-orm/mysql-proxy");
	return {
		...schema,
		db: drizzle(async (sql, params) => {
			state.queries.push({ sql, params });
			if (state.failUsers && sql.includes("from `users`"))
				throw Error("users unavailable");
			return { rows: sql.includes("count(*)") ? [[50]] : [] };
		}),
	};
});

import { loadPublicSearch } from "./public-search";

describe("public search", () => {
	beforeEach(() => {
		state.queries = [];
		state.failUsers = false;
	});
	it("does not query for a blank term", async () => {
		expect(await loadPublicSearch({ query: "  " })).toBeNull();
		expect(state.queries).toEqual([]);
	});
	it("searches all four categories with public visibility predicates", async () => {
		const result = await loadPublicSearch({ query: "needle'", roomsPage: 2 });
		expect(result?.rooms.status).toBe("fulfilled");
		const rooms = state.queries.filter((q) => q.sql.includes("from `rooms`"));
		expect(rooms[0].params).toEqual(["%needle'%", "open"]);
		expect(rooms[1].params.slice(-2)).toEqual([12, 12]);
		const news = state.queries.find((q) =>
			q.sql.includes("from `website_articles`"),
		);
		expect(news?.sql).toContain("<= NOW()");
		expect(news?.params[0]).toBe("published");
		const events = state.queries.find((q) =>
			q.sql.includes("from `website_events`"),
		);
		expect(events?.params.slice(0, 2)).toEqual(["published", "completed"]);
	});
	it("preserves successful categories when one query fails", async () => {
		state.failUsers = true;
		const result = await loadPublicSearch({ query: "test" });
		expect(result?.users.status).toBe("rejected");
		expect(result?.rooms.status).toBe("fulfilled");
		expect(result?.news.status).toBe("fulfilled");
		expect(result?.events.status).toBe("fulfilled");
	});
	it("clamps each independent page and limits query length", async () => {
		const result = await loadPublicSearch({
			query: "x".repeat(500),
			usersPage: 999,
			roomsPage: -1,
		});
		expect(result?.query).toHaveLength(191);
		expect(result?.users).toMatchObject({
			status: "fulfilled",
			value: { page: 5 },
		});
		expect(result?.rooms).toMatchObject({
			status: "fulfilled",
			value: { page: 1 },
		});
	});
});
