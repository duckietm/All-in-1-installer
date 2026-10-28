import { describe, expect, it } from "vitest";
import type { TreeNode } from "@/types/catalog";
import {
	applyCatalogTotals,
	applyCatalogTreeDelta,
	type CatalogTreeDelta,
	type CreatedCatalogPage,
	EMPTY_CATALOG_DELTA,
	isEmptyCatalogDelta,
	normalizeCatalogTotals,
	normalizeTreePages,
	recomputeDepth,
} from "./live-catalog-merge";

function node(over: Partial<TreeNode> & { id: number }): TreeNode {
	return {
		caption: `page ${over.id}`,
		parentId: -1,
		depth: 0,
		orderNum: 0,
		enabled: "1",
		visible: "1",
		iconImage: 0,
		iconColor: 0,
		pageLayout: "default_3x3",
		childCount: 0,
		itemCount: 0,
		...over,
	};
}

function created(
	over: Partial<CreatedCatalogPage> & { id: number },
): CreatedCatalogPage {
	return {
		caption: `new ${over.id}`,
		parentId: -1,
		pageLayout: "default_3x3",
		iconImage: 0,
		iconColor: 0,
		orderNum: 0,
		enabled: "1",
		visible: "1",
		...over,
	};
}

const delta = (over: Partial<CatalogTreeDelta> = {}): CatalogTreeDelta => ({
	...EMPTY_CATALOG_DELTA,
	...over,
});

describe("recomputeDepth", () => {
	it("nests children below their parent and keeps roots at 0", () => {
		expect(
			recomputeDepth([
				node({ id: 1, parentId: -1 }),
				node({ id: 2, parentId: 1 }),
				node({ id: 3, parentId: 2 }),
				node({ id: 4, parentId: -1 }),
			]).map((n) => n.depth),
		).toEqual([0, 1, 2, 0]);
	});

	it("terminates on a parent cycle instead of recursing forever", () => {
		// A messy DB can contain a looping parent chain. The server's getTreeFlat
		// resolves such a cycle to a finite depth too, so the client only has to
		// agree that it terminates and never goes negative.
		for (const input of [
			[node({ id: 1, parentId: 1 })],
			[node({ id: 1, parentId: 2 }), node({ id: 2, parentId: 1 })],
			[
				node({ id: 1, parentId: 3 }),
				node({ id: 2, parentId: 1 }),
				node({ id: 3, parentId: 2 }),
			],
		]) {
			const depths = recomputeDepth(input).map((n) => n.depth);
			expect(depths.every((d) => Number.isInteger(d) && d >= 0)).toBe(true);
			expect(depths).toHaveLength(input.length);
		}
	});

	it("returns the same node objects when depths are already correct", () => {
		const input = [
			node({ id: 1, depth: 0 }),
			node({ id: 2, parentId: 1, depth: 1 }),
		];
		expect(recomputeDepth(input)[1]).toBe(input[1]);
	});
});

describe("applyCatalogTreeDelta", () => {
	const tree = [
		node({ id: 1, parentId: -1, orderNum: 1, childCount: 1, itemCount: 10 }),
		node({ id: 2, parentId: 1, orderNum: 1, itemCount: 4 }),
	];

	it("returns the same array when the delta is empty", () => {
		expect(applyCatalogTreeDelta(tree, delta())).toBe(tree);
	});

	it("inserts a new page in sibling order with the right depth", () => {
		const next = applyCatalogTreeDelta(
			tree,
			delta({ pages: [created({ id: 3, parentId: 1, orderNum: 0 })] }),
		);
		expect(next.map((n) => [n.id, n.orderNum, n.depth])).toEqual([
			[3, 0, 1],
			[1, 1, 0],
			[2, 1, 1],
		]);
	});

	it("bumps the parent child count and the total item count", () => {
		const next = applyCatalogTreeDelta(
			tree,
			delta({
				pages: [created({ id: 3, parentId: 1 })],
				addedItems: [{ pageId: 3, count: 6 }],
			}),
		);
		expect(next.find((n) => n.id === 1)?.childCount).toBe(2);
		expect(next.find((n) => n.id === 3)?.itemCount).toBe(6);
	});

	it("skips a page the tree already knows about", () => {
		const next = applyCatalogTreeDelta(
			tree,
			delta({
				pages: [created({ id: 2, parentId: 1 })],
				addedItems: [{ pageId: 2, count: 3 }],
			}),
		);
		expect(next).toHaveLength(2);
		expect(next.find((n) => n.id === 2)?.itemCount).toBe(7);
		// A reused destination is not a new child, so childCount must not grow.
		expect(next.find((n) => n.id === 1)?.childCount).toBe(1);
	});

	it("shifts item counts between pages for a move without changing the total", () => {
		const next = applyCatalogTreeDelta(
			tree,
			delta({ movedItems: [{ fromPageId: 2, toPageId: 1, count: 4 }] }),
		);
		expect(next.find((n) => n.id === 1)?.itemCount).toBe(14);
		expect(next.find((n) => n.id === 2)?.itemCount).toBe(0);
	});

	it("never lets an item count go negative", () => {
		const next = applyCatalogTreeDelta(
			tree,
			delta({ movedItems: [{ fromPageId: 2, toPageId: 1, count: 99 }] }),
		);
		expect(next.find((n) => n.id === 2)?.itemCount).toBe(0);
	});

	it("inserts several pages in one pass with correct depths", () => {
		const next = applyCatalogTreeDelta(
			tree,
			delta({
				pages: [
					created({ id: 3, parentId: 1, orderNum: 2 }),
					created({ id: 4, parentId: 3, orderNum: 1 }),
				],
			}),
		);
		expect(next.find((n) => n.id === 4)?.depth).toBe(2);
		expect(next.find((n) => n.id === 3)?.childCount).toBe(1);
	});
});

describe("applyCatalogTotals", () => {
	const totals = { totalPages: 9, enabledPages: 8, totalItems: 100 };

	it("counts new pages and new offers, but not moves", () => {
		expect(
			applyCatalogTotals(
				totals,
				delta({
					pages: [
						created({ id: 20, enabled: "1" }),
						created({ id: 21, enabled: "0" }),
					],
					addedItems: [{ pageId: 20, count: 5 }],
					movedItems: [{ fromPageId: 1, toPageId: 20, count: 3 }],
				}),
			),
		).toEqual({ totalPages: 11, enabledPages: 9, totalItems: 105 });
	});

	it("returns the same object for an empty delta", () => {
		expect(applyCatalogTotals(totals, delta())).toBe(totals);
	});
});

describe("normalizeTreePages", () => {
	it("coerces an API payload into TreeNode and drops unusable rows", () => {
		expect(
			normalizeTreePages([
				{ id: "4", caption: "Wired", parentId: "0", orderNum: "2" },
				{ id: 0, caption: "bogus" },
				{ caption: "no id" },
				null,
				"nope",
			]),
		).toEqual([
			{
				id: 4,
				caption: "Wired",
				parentId: -1,
				depth: 0,
				orderNum: 2,
				enabled: "0",
				visible: "0",
				iconImage: 0,
				iconColor: 0,
				pageLayout: "default_3x3",
				childCount: 0,
				itemCount: 0,
			},
		]);
	});

	it("returns an empty list for a non-array payload", () => {
		expect(normalizeTreePages(undefined)).toEqual([]);
	});
});

describe("isEmptyCatalogDelta", () => {
	it("ignores zero-count entries", () => {
		expect(
			isEmptyCatalogDelta({
				pages: [],
				addedItems: [{ pageId: 1, count: 0 }],
				movedItems: [],
			}),
		).toBe(false);
		expect(isEmptyCatalogDelta(EMPTY_CATALOG_DELTA)).toBe(true);
	});
});

describe("normalizeCatalogTotals", () => {
	it("accepts a totals payload from the tree route", () => {
		expect(
			normalizeCatalogTotals({
				totalPages: 12,
				enabledPages: 9,
				totalItems: 400,
			}),
		).toEqual({ totalPages: 12, enabledPages: 9, totalItems: 400 });
	});

	it("coerces string counts the way MariaDB drivers return them", () => {
		expect(
			normalizeCatalogTotals({
				totalPages: "12",
				enabledPages: "9",
				totalItems: "400",
			}),
		).toEqual({ totalPages: 12, enabledPages: 9, totalItems: 400 });
	});

	it("accepts an explicit zeroed payload for an empty catalog", () => {
		expect(
			normalizeCatalogTotals({
				totalPages: 0,
				enabledPages: 0,
				totalItems: 0,
			}),
		).toEqual({ totalPages: 0, enabledPages: 0, totalItems: 0 });
	});

	it("rejects a missing or partial payload so the store keeps its counts", () => {
		expect(normalizeCatalogTotals(undefined)).toBeNull();
		expect(normalizeCatalogTotals("nope")).toBeNull();
		expect(normalizeCatalogTotals({ totalPages: 3 })).toBeNull();
	});
});
