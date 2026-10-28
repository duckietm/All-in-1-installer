import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	queries: [] as { sql: string; params: unknown[] }[],
	categories: [] as unknown[],
	furniture: [] as unknown[],
	offers: [] as unknown[],
	parents: [] as unknown[],
}));
vi.mock("@/lib/db", async () => {
	const db = {
		execute: vi.fn(async (query: SQL) => {
			const result = new MySqlDialect().sqlToQuery(query);
			state.queries.push(result);
			if (result.sql.includes("FROM items_base")) return [state.furniture];
			if (result.sql.includes("SELECT i.id")) return [state.offers];
			if (result.sql.includes("WHERE id IN")) return [state.parents];
			return [state.categories];
		}),
	};
	return {
		db,
		...(await import("@/test/db-helpers")).createDbHelpers(db.execute),
	};
});

import { searchCatalog } from "./search";

beforeEach(() => {
	state.queries = [];
	state.categories = [];
	state.furniture = [];
	state.offers = [];
	state.parents = [];
});
describe("bounded catalog search", () => {
	it.each(["", "a", " ", "x".repeat(101)])(
		"rejects invalid query before SQL: %s",
		async (query) => {
			await expect(searchCatalog("normal", query)).rejects.toThrow(
				"Search requires",
			);
			expect(state.queries).toHaveLength(0);
		},
	);
	it("rejects an unknown catalog instead of interpolating a table name", async () => {
		await expect(searchCatalog("other", "chair")).rejects.toThrow(
			"Invalid catalog type",
		);
		expect(state.queries).toHaveLength(0);
	});
	it("binds text and treats user wildcard characters literally", async () => {
		await searchCatalog("normal", "chair_%' OR 1=1");
		expect(state.queries.every((query) => !query.sql.includes("chair"))).toBe(
			true,
		);
		expect(state.queries[0].params).toContain("chair=_=%' OR 1==1%");
		expect(state.queries.every((query) => query.sql.includes("LIMIT"))).toBe(
			true,
		);
	});
	it.each(["normal", "bc"])(
		"finds numeric IDs and resolves bounded category paths for %s",
		async (kind) => {
			state.furniture = [{ id: 7, classname: "chair", spriteId: 9 }];
			state.offers = [
				{
					id: 50,
					caption: "Offer",
					pageId: "11",
					pageCaption: "Chairs",
					parentId: 1,
					itemIds: "3;7",
				},
			];
			state.parents = [{ id: 1, caption: "Shop", parentId: -1 }];
			const results = await searchCatalog(kind, "9");
			expect(results).toEqual([
				{
					kind: "offer",
					id: 50,
					pageId: 11,
					caption: "Offer",
					path: ["Shop", "Chairs"],
					href:
						kind === "bc"
							? "/admin/catalog/builder-club/11"
							: "/admin/catalog/11",
					furniture: { id: 7, classname: "chair", spriteId: 9 },
				},
			]);
			const offers = state.queries.find((query) =>
				query.sql.includes("SELECT i.id"),
			);
			expect(offers?.sql.includes("i.offer_id")).toBe(kind === "normal");
			expect(offers?.sql).toContain(
				kind === "bc" ? "catalog_items_bc" : "catalog_items",
			);
			expect(offers?.params).toContain("7");
			expect(offers?.params).toContain("9");
			expect(state.queries).toHaveLength(4);
		},
	);
	it("caps final results and furniture bundle predicates even if a repository overreturns", async () => {
		state.categories = Array.from({ length: 40 }, (_, index) => ({
			id: index + 1,
			caption: "Category",
			parentId: -1,
		}));
		state.furniture = Array.from({ length: 80 }, (_, index) => ({
			id: index + 1,
			classname: "chair",
			spriteId: index,
		}));
		state.offers = Array.from({ length: 80 }, (_, index) => ({
			id: index + 1,
			caption: "Offer",
			pageId: 1,
			pageCaption: "Category",
			parentId: -1,
			itemIds: "1",
		}));
		const results = await searchCatalog("normal", "chair");
		expect(results).toHaveLength(25);
		const query = state.queries.find((query) =>
			query.sql.includes("SELECT i.id"),
		);
		expect(query?.sql.match(/FIND_IN_SET/g)).toHaveLength(25);
		expect(query?.params.at(-1)).toBe(13);
	});
	it("terminates corrupt cyclic category paths without repeated parent queries", async () => {
		state.categories = [{ id: 1, caption: "One", parentId: 2 }];
		state.parents = [{ id: 2, caption: "Two", parentId: 1 }];
		const results = await searchCatalog("normal", "One");
		expect(results[0].path).toEqual(["Two", "One"]);
		expect(state.queries).toHaveLength(4);
	});
});
