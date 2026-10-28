// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	total: 55,
	fail: false,
	rows: [] as unknown[],
	queries: [] as { sql: string; params: unknown[] }[],
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { drizzle } = await import("drizzle-orm/mysql-proxy");
	return {
		...schema,
		db: drizzle(async (sql, params) => {
			if (state.fail) throw new Error("unavailable");
			state.queries.push({ sql, params });
			if (sql.includes("count(*)")) return { rows: [[state.total]] };
			return { rows: state.rows };
		}),
	};
});

import { loadNewsArchive } from "./news-archive";

describe("public news archive", () => {
	beforeEach(() => {
		state.total = 55;
		state.fail = false;
		state.rows = [];
		state.queries = [];
	});
	it("filters unpublished and future articles before counting and paginating", async () => {
		const result = await loadNewsArchive({ search: "needle'", page: 2 });
		expect(result).toMatchObject({ total: 55, page: 2, lastPage: 3 });
		for (const query of state.queries) {
			expect(query.sql).toContain("`status` = ?");
			expect(query.sql).toContain("<= NOW()");
			expect(query.params.slice(0, 3)).toEqual([
				"published",
				"%needle'%",
				"%needle'%",
			]);
		}
		expect(state.queries[1].params.slice(-2)).toEqual([24, 24]);
		expect(state.queries[1].sql).toMatch(
			/order by COALESCE.* desc, .*`id` desc/,
		);
	});
	it("orders oldest first by publication time and bounds the last page", async () => {
		expect(await loadNewsArchive({ page: 999, order: "oldest" })).toMatchObject(
			{ page: 3, order: "oldest" },
		);
		expect(state.queries[1].sql).toMatch(/order by COALESCE.* asc, .*`id` asc/);
		expect(state.queries[1].params.slice(-2)).toEqual([24, 48]);
	});
	it("handles empty results and invalid pagination", async () => {
		state.total = 0;
		expect(await loadNewsArchive({ page: NaN, order: "bad" })).toMatchObject({
			page: 1,
			lastPage: 1,
			order: "newest",
		});
	});
	it("propagates failures instead of presenting them as an empty archive", async () => {
		state.fail = true;
		// Its own search term, so the entry is a cache miss and the failure
		// actually reaches the database.
		await expect(loadNewsArchive({ search: "boom" })).rejects.toThrow();
	});

	it("serves a repeated query from cache without querying again", async () => {
		const first = await loadNewsArchive({ search: "repeat", page: 1 });
		expect(state.queries.length).toBeGreaterThan(0);
		const after = state.queries.length;
		const second = await loadNewsArchive({ search: "repeat", page: 1 });
		expect(second).toEqual(first);
		expect(state.queries.length).toBe(after);
	});

	it("keeps cache entries separate per search, page and order", async () => {
		await loadNewsArchive({ search: "distinct", page: 1 });
		const after = state.queries.length;
		await loadNewsArchive({ search: "distinct", page: 2 });
		await loadNewsArchive({ search: "distinct", page: 1, order: "oldest" });
		await loadNewsArchive({ search: "different", page: 1 });
		expect(state.queries.length).toBeGreaterThan(after);
	});

	it("returns createdAt as a Date on a cache hit", async () => {
		const rows = [
			{
				slug: "a",
				title: "A",
				shortStory: "s",
				image: null,
				createdAt: new Date("2024-01-02T03:04:05.000Z"),
			},
		];
		state.rows = rows;
		const first = await loadNewsArchive({ search: "dates" });
		expect(first.rows[0]?.createdAt).toBeInstanceOf(Date);
		const second = await loadNewsArchive({ search: "dates" });
		expect(second.rows[0]?.createdAt).toBeInstanceOf(Date);
		expect(second.rows[0]?.createdAt.getTime()).toBe(
			first.rows[0]?.createdAt.getTime(),
		);
	});
});
