// @ts-nocheck
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	items: [] as Array<Record<string, unknown>>,
	pages: [] as Array<Record<string, unknown>>,
	bases: [] as Array<Record<string, unknown>>,
	orderRows: [] as Array<Record<string, unknown>>,
	cycleRows: [] as Array<Record<string, unknown>>,
	childrenByParent: {} as Record<string, Array<Record<string, unknown>>>,
	queries: [] as { sql: string; params: unknown[] }[],
	writes: 0,
}));
vi.mock("@/lib/db", async () => {
	const db = {
		execute: async (query: SQL) => {
			const compiled = new MySqlDialect().sqlToQuery(query);
			if (compiled.sql.includes("FROM catalog_items ci"))
				return [state.items, []];
			if (compiled.sql.includes("FROM catalog_pages")) return [state.pages, []];
			if (compiled.sql.includes("FROM items_base")) return [state.bases, []];
			return [[], []];
		},
		transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
			return fn({
				execute: async (query: SQL) => {
					const compiled = new MySqlDialect().sqlToQuery(query);
					state.queries.push(compiled);
					const sqlText = compiled.sql.replace(/\s+/g, " ").trim();
					if (sqlText.includes("SELECT id, page_id AS pageId, order_number"))
						return [state.orderRows, []];
					if (
						sqlText.includes(
							"SELECT id, parent_id AS parentId FROM catalog_pages",
						)
					)
						return [state.cycleRows, []];
					if (
						sqlText.includes(
							"SELECT id, order_num AS orderNum FROM catalog_pages",
						)
					) {
						const parent = String(compiled.params[0]);
						return [state.childrenByParent[parent] ?? [], []];
					}
					if (sqlText.startsWith("SELECT")) return [state.orderRows, []];
					state.writes++;
					return [{ affectedRows: 1 }, []];
				},
			});
		},
	};
	return {
		db,
		...(await import("@/test/db-helpers")).createDbHelpers(db.execute),
	};
});

import { fixEmulatorIssues, listEmulatorIssues } from "./furni-maintenance";

const item = (id: number, overrides: Record<string, unknown> = {}) => ({
	id,
	pageId: 10,
	itemIds: "12",
	costCredits: 0,
	costPoints: 0,
	pointsType: 0,
	amount: 1,
	limitedStack: 0,
	limitedSells: 0,
	orderNumber: 1,
	...overrides,
});

beforeEach(() => {
	state.items = [];
	state.pages = [{ id: 10, parentId: 0, orderNum: 1 }];
	state.bases = [{ id: 12 }];
	state.orderRows = [];
	state.cycleRows = [];
	state.childrenByParent = {};
	state.queries = [];
	state.writes = 0;
});

describe("listEmulatorIssues", () => {
	it("flags every emulator constraint violation on one row", async () => {
		state.items = [
			item(1, {
				pageId: 500,
				itemIds: "10834",
				pointsType: 101,
				costCredits: -1,
				amount: 0,
			}),
		];
		const issues = await listEmulatorIssues();
		const types = issues.map((i) => i.type).sort();
		expect(types).toContain("missing_page");
		expect(types).toContain("missing_item");
		expect(types).toContain("points_currency");
		expect(types).toContain("negative_cost");
		expect(types).toContain("nonpositive_amount");
	});

	it("flags limited stack below the sold count", async () => {
		state.items = [item(1, { limitedStack: 5, limitedSells: 10 })];
		const issues = await listEmulatorIssues();
		expect(issues.map((i) => i.type)).toContain("limited_stack_vs_sells");
	});

	it("flags sibling offers that share an order number on the same page", async () => {
		state.items = [
			item(1, { orderNumber: 1 }),
			item(2, { orderNumber: 1 }),
			item(3, { orderNumber: 2 }),
		];
		const issues = await listEmulatorIssues();
		const dup = issues.filter((i) => i.type === "duplicate_order");
		expect(dup.map((i) => i.id).sort()).toEqual([1, 2]);
	});

	it("accepts valid pricing row without flagging", async () => {
		state.items = [item(1, { orderNumber: 1 })];
		const issues = await listEmulatorIssues();
		expect(issues).toEqual([]);
	});
});

describe("fixEmulatorIssues", () => {
	it("deletes orphans, sanitizes pricing and renumbers duplicate orders", async () => {
		state.items = [
			item(1, {
				pageId: 500,
				itemIds: "10834",
				pointsType: 101,
				costCredits: -5,
				costPoints: -1,
				amount: 0,
			}),
			item(2, { limitedStack: 5, limitedSells: 10 }),
			item(3, { orderNumber: 1 }),
			item(4, { orderNumber: 1 }),
			item(5, { orderNumber: 2 }),
		];
		state.orderRows = [
			{ id: 3, pageId: 10, orderNumber: 1 },
			{ id: 4, pageId: 10, orderNumber: 1 },
			{ id: 5, pageId: 10, orderNumber: 2 },
		];

		const result = await fixEmulatorIssues();

		const bySql = (needle: string) =>
			state.queries.filter((q) =>
				q.sql.replace(/\s+/g, " ").trimStart().includes(needle),
			);
		const deleteItems = bySql("DELETE FROM catalog_items WHERE id IN");
		expect(deleteItems.length).toBe(1);
		expect(deleteItems[0].params).toContain(1);

		const pointsFix = bySql(
			"UPDATE catalog_items SET points_type = 0 WHERE id IN",
		);
		expect(pointsFix.length).toBe(1);
		expect(pointsFix[0].params).toContain(1);

		const costFix = bySql("cost_credits = CASE WHEN cost_credits < 0");
		expect(costFix.length).toBe(1);

		const amountFix = bySql("UPDATE catalog_items SET amount = 1 WHERE id IN");
		expect(amountFix.length).toBe(1);

		const limitedFix = bySql(
			"UPDATE catalog_items SET limited_stack = limited_sells WHERE id IN",
		);
		expect(limitedFix.length).toBe(1);
		expect(limitedFix[0].params).toContain(2);

		expect(state.writes).toBeGreaterThan(0);
		expect(result.detail.length).toBeGreaterThan(0);
	});

	it("does not write when there is nothing to fix", async () => {
		state.items = [item(1, { orderNumber: 1 })];
		const result = await fixEmulatorIssues();
		expect(result.fixed).toBe(0);
		expect(state.writes).toBe(0);
	});
});

describe("page hierarchy checks", () => {
	it("flags pages whose parent chain forms a cycle", async () => {
		state.pages = [
			{ id: 354, parentId: 354, orderNum: 4 },
			{ id: 357, parentId: 357, orderNum: 7 },
		];
		const issues = await listEmulatorIssues();
		const cycles = issues.filter((i) => i.type === "page_cycle");
		expect(cycles.map((i) => i.id).sort()).toEqual([354, 357]);
	});

	it("does not flag pages with a valid parent chain", async () => {
		state.pages = [{ id: 354, parentId: 10, orderNum: 4 }];
		const issues = await listEmulatorIssues();
		expect(issues.filter((i) => i.type === "page_cycle")).toEqual([]);
	});

	it("flags sibling pages that share an order_num under the same parent", async () => {
		state.pages = [
			{ id: 110, parentId: 49, orderNum: 1 },
			{ id: 111, parentId: 49, orderNum: 1 },
			{ id: 112, parentId: 49, orderNum: 2 },
			{ id: 120, parentId: 0, orderNum: 1 },
		];
		const issues = await listEmulatorIssues();
		const flags = issues.filter((i) => i.type === "sibling_page_order");
		expect(flags.map((i) => i.id).sort()).toEqual([110, 111]);
		expect(flags.every((i) => i.pageId === 49)).toBe(true);
	});

	it("breaks cycles and re-numbers sibling pages in one transaction", async () => {
		state.pages = [
			{ id: 10, parentId: 0, orderNum: 1 },
			{ id: 354, parentId: 354, orderNum: 4 },
			{ id: 357, parentId: 357, orderNum: 7 },
			{ id: 110, parentId: 49, orderNum: 1 },
			{ id: 111, parentId: 49, orderNum: 1 },
			{ id: 112, parentId: 49, orderNum: 2 },
		];
		state.cycleRows = [
			{ id: 354, parentId: 354 },
			{ id: 357, parentId: 357 },
		];
		state.childrenByParent["49"] = [
			{ id: 110, orderNum: 1 },
			{ id: 111, orderNum: 1 },
			{ id: 112, orderNum: 2 },
		];

		await fixEmulatorIssues();

		const bySql = (needle: string) =>
			state.queries.filter((q) =>
				q.sql.replace(/\s+/g, " ").trimStart().includes(needle),
			);
		const detach = bySql("UPDATE catalog_pages SET parent_id = 0 WHERE id");
		expect(detach.length).toBe(2);
		expect([...detach[0].params, ...detach[1].params]).toEqual([354, 357]);

		const reorder = bySql("UPDATE catalog_pages SET order_num =");
		expect(reorder.length).toBe(2);
		expect([...reorder[0].params, ...reorder[1].params]).toEqual([
			2, 111, 3, 112,
		]);
	});
});
