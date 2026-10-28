// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "catalog_move_suggestions";
const store = new Map<string, string>();

vi.stubGlobal("localStorage", {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => store.set(k, v),
});

import { getSuggestions, recordMove } from "./move-suggestions";

beforeEach(() => store.clear());

describe("recordMove", () => {
	it("records by interaction type", () => {
		recordMove({ interactionType: "clothing", targetPageId: 42 });
		expect(getSuggestions({ interactionType: "clothing" })).toContain(42);
	});

	it("records by item name prefix", () => {
		recordMove({ itemName: "rare_sofa", targetPageId: 7 });
		expect(getSuggestions({ itemName: "rare_table" })).toContain(7);
	});

	it("records recent targets, deduplicated", () => {
		recordMove({ targetPageId: 1 });
		recordMove({ targetPageId: 2 });
		recordMove({ targetPageId: 1 });
		const recent = JSON.parse(store.get(STORAGE_KEY) ?? "") as {
			recent: number[];
		};
		expect(recent.recent).toEqual([1, 2]);
	});

	it("caps recent at 10 entries", () => {
		for (let i = 1; i <= 12; i++) recordMove({ targetPageId: i });
		const recent = JSON.parse(store.get(STORAGE_KEY) ?? "") as {
			recent: number[];
		};
		expect(recent.recent.length).toBe(10);
	});

	it("increments counts and re-sorts", () => {
		recordMove({ interactionType: "clothing", targetPageId: 1 });
		recordMove({ interactionType: "clothing", targetPageId: 2 });
		recordMove({ interactionType: "clothing", targetPageId: 1 });
		const suggestions = getSuggestions({ interactionType: "clothing" });
		expect(suggestions[0]).toBe(1);
	});

	it("handles a corrupt store gracefully", () => {
		store.set(STORAGE_KEY, "not-json{");
		expect(() =>
			recordMove({ interactionType: "x", targetPageId: 3 }),
		).not.toThrow();
		expect(getSuggestions({ interactionType: "x" })).toContain(3);
	});
});

describe("getSuggestions", () => {
	it("ranks type matches above prefix matches", () => {
		recordMove({ interactionType: "clothing", targetPageId: 1 });
		recordMove({ itemName: "rare_x", targetPageId: 2 });
		// same page both ways => type weight wins, but both present
		recordMove({
			interactionType: "clothing",
			itemName: "rare_y",
			targetPageId: 3,
		});
		const suggestions = getSuggestions({
			interactionType: "clothing",
			itemName: "rare_z",
		});
		expect(suggestions[0]).toBe(3);
	});

	it("returns [] with no data", () => {
		expect(getSuggestions({})).toEqual([]);
	});
});
