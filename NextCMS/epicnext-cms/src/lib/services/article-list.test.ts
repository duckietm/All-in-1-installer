// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	total: 55,
	queries: [] as { sql: string; params: unknown[] }[],
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { drizzle } = await import("drizzle-orm/mysql-proxy");
	return {
		...schema,
		db: drizzle(async (sql, params) => {
			state.queries.push({ sql, params });
			return { rows: sql.includes("count(*)") ? [[state.total]] : [] };
		}),
	};
});

import { loadArticleList } from "./article-list";

describe("article listing", () => {
	beforeEach(() => {
		state.queries = [];
		state.total = 55;
	});
	it("filters drafts before pagination and binds search text", async () => {
		const result = await loadArticleList({
			status: "draft",
			search: "needle'",
			page: 2,
		});
		expect(result.page).toBe(2);
		for (const query of state.queries) {
			expect(query.sql).toContain("`website_articles`.`status` = ?");
			expect(query.sql).not.toContain("needle");
			expect(query.params.slice(0, 3)).toEqual([
				"draft",
				"%needle'%",
				"%needle'%",
			]);
		}
		expect(state.queries[1].params.slice(-2)).toEqual([24, 24]);
	});
	it("clamps an out-of-range page to the last filtered page", async () => {
		const result = await loadArticleList({ status: "scheduled", page: 999 });
		expect(result).toMatchObject({ page: 3, lastPage: 3, total: 55 });
		expect(state.queries[1].params.slice(-2)).toEqual([24, 48]);
	});
	it("bounds invalid input and keeps an empty collection on page one", async () => {
		state.total = 0;
		const result = await loadArticleList({ status: "unexpected", page: NaN });
		expect(result).toMatchObject({
			status: "all",
			page: 1,
			lastPage: 1,
			total: 0,
		});
		expect(state.queries[1].sql).not.toContain(
			"`website_articles`.`status` = ?",
		);
	});
});
