// @ts-nocheck
import { describe, expect, it } from "vitest";
import { CATALOG_LAYOUTS, LAYOUT_DESCRIPTIONS } from "./catalog-layouts";

describe("CATALOG_LAYOUTS", () => {
	it("contains the common Habbo layouts", () => {
		for (const layout of [
			"frontpage",
			"default_3x3",
			"spaces_new",
			"marketplace",
			"room_bundle",
		]) {
			expect(CATALOG_LAYOUTS).toContain(layout);
		}
	});

	it("has a description for every layout", () => {
		for (const layout of CATALOG_LAYOUTS) {
			expect(LAYOUT_DESCRIPTIONS[layout]).toBeTruthy();
		}
	});

	it("descriptions are non-empty", () => {
		for (const desc of Object.values(LAYOUT_DESCRIPTIONS)) {
			expect(desc.length).toBeGreaterThan(0);
		}
	});
});
