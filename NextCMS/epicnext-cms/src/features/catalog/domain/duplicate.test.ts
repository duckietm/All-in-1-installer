import { describe, expect, it } from "vitest";
import { duplicateSubtree, remapIncludes } from "./duplicate";

describe("category duplication", () => {
	const pages = [
		{ id: 1, parent_id: -1 },
		{ id: 2, parent_id: 1 },
		{ id: 3, parent_id: 2 },
		{ id: 4, parent_id: -1 },
	];
	it("collects all descendants in parent-first order", () =>
		expect(duplicateSubtree(pages, 1, 4).map((p) => p.id)).toEqual([1, 2, 3]));
	it("rejects corrupt source cycles and missing destination", () => {
		expect(() =>
			duplicateSubtree(
				[
					{ id: 1, parent_id: 2 },
					{ id: 2, parent_id: 1 },
				],
				1,
				-1,
			),
		).toThrow();
		expect(() => duplicateSubtree(pages, 1, 99)).toThrow();
	});
	it("rejects missing source ancestry", () =>
		expect(() =>
			duplicateSubtree([{ id: 1, parent_id: 99 }], 1, -1),
		).toThrow());
	it("remaps internal includes and preserves external references", () =>
		expect(remapIncludes("2;4", new Map([[2, 20]]), new Set([2, 4]))).toBe(
			"20;4",
		));
	it("rejects broken included references", () =>
		expect(() => remapIncludes("99", new Map(), new Set([2]))).toThrow());
});
