import { describe, expect, it } from "vitest";
import {
	assertParent,
	collectSubtree,
	nextFreeSiblingOrder,
	validateSiblingOrder,
} from "./hierarchy";

const pages = [
	{ id: 1, parentId: -1, orderNum: 0 },
	{ id: 2, parentId: 1, orderNum: 1 },
	{ id: 3, parentId: 1, orderNum: 2 },
	{ id: 4, parentId: 2, orderNum: 1 },
];
describe("catalog hierarchy commands", () => {
	it("rejects self, descendant, missing and malformed destinations", () => {
		for (const parent of [1, 2, 4, 999, 1.5, -2])
			expect(() => assertParent(pages, 1, parent)).toThrow();
	});
	it("allows detaching a page from an inherited cycle", () =>
		expect(() =>
			assertParent(
				[
					{ id: 1, parentId: 2 },
					{ id: 2, parentId: 1 },
				],
				1,
				-1,
			),
		).not.toThrow());
	it("rejects a destination with an inherited parent cycle", () =>
		expect(() =>
			assertParent(
				[
					{ id: 1, parentId: -1 },
					{ id: 2, parentId: 3 },
					{ id: 3, parentId: 2 },
				],
				1,
				2,
			),
		).toThrow());
	it("collects cyclic subtrees once without recursion", () =>
		expect(
			collectSubtree(
				[
					{ id: 1, parentId: 2 },
					{ id: 2, parentId: 1 },
				],
				1,
			),
		).toEqual([1, 2]));
	it("rejects stale or partial sibling lists before reordering", () => {
		expect(() => validateSiblingOrder(pages, 1, [2], [2, 3])).toThrow();
		expect(() => validateSiblingOrder(pages, 1, [3, 2], [3, 2])).toThrow();
		expect(() => validateSiblingOrder(pages, 1, [2, 2], [2, 3])).toThrow();
	});
	it("accepts a complete reorder matching the previous sibling order", () =>
		expect(() => validateSiblingOrder(pages, 1, [3, 2], [2, 3])).not.toThrow());
});

it("orders mixed root conventions with a stable ID tie breaker", () => {
	const roots = [
		{ id: 3, parentId: 0, orderNum: 1 },
		{ id: 2, parentId: -1, orderNum: 1 },
	];
	expect(() => validateSiblingOrder(roots, -1, [3, 2], [2, 3])).not.toThrow();
	expect(() => validateSiblingOrder(roots, -1, [2, 3], [3, 2])).toThrow();
});

describe("nextFreeSiblingOrder", () => {
	it("keeps an explicit order that no sibling holds", () => {
		expect(nextFreeSiblingOrder(pages, 1, 7)).toBe(7);
		// Parent 1's siblings sit at order 1 and 2, so 0 is still free.
		expect(nextFreeSiblingOrder(pages, 1, 0)).toBe(0);
	});
	it("appends instead of duplicating a taken order", () => {
		// Requesting an order a sibling already holds would make the emulator
		// reject the whole catalog, so the page lands after the last sibling.
		expect(nextFreeSiblingOrder(pages, 1, 1)).toBe(3);
		expect(nextFreeSiblingOrder(pages, 1, 2)).toBe(3);
		expect(nextFreeSiblingOrder(pages, 2, 1)).toBe(2);
	});
	it("appends when the caller gives no order at all", () => {
		expect(nextFreeSiblingOrder(pages, 1)).toBe(3);
		expect(nextFreeSiblingOrder(pages, 2)).toBe(2);
	});
	it("counts parent -1 and parent 0 as the same sibling set", () => {
		expect(
			nextFreeSiblingOrder([{ id: 2, parentId: 0, orderNum: 1 }], -1, 1),
		).toBe(2);
		expect(
			nextFreeSiblingOrder([{ id: 2, parentId: -1, orderNum: 1 }], 0, 1),
		).toBe(2);
	});
	it("treats a missing orderNum as 0 when looking for collisions", () => {
		expect(nextFreeSiblingOrder([{ id: 5, parentId: 1 }], 1, 0)).toBe(1);
	});
	it("gives the first child of an empty parent the requested order", () => {
		expect(nextFreeSiblingOrder([], -1, 0)).toBe(0);
		expect(nextFreeSiblingOrder([], -1)).toBe(1);
	});
});
