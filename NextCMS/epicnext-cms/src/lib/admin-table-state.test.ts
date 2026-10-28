// @ts-nocheck
import { expect, it } from "vitest";
import { tablePageNumbers } from "./admin-table-state";

it.each([
	[1, 1],
	[1, 7],
	[6, 7],
	[7, 7],
	[50, 100],
	[100, 100],
])("includes the current page %i/%i and stays in bounds", (page, last) => {
	const pages = tablePageNumbers(page, last);
	expect(pages).toContain(page);
	expect(pages.length).toBeLessThanOrEqual(5);
	expect(pages.every((p) => p >= 1 && p <= last)).toBe(true);
	expect(new Set(pages).size).toBe(pages.length);
});
