// @ts-nocheck
import { describe, expect, it } from "vitest";
import { CATALOG_IT, translateCaption } from "./catalog-translations";

describe("translateCaption", () => {
	it("returns the Italian translation for a known caption", () => {
		expect(translateCaption("furniture")).toBe("Mobili");
		expect(translateCaption("RARE")).toBe("Rari");
	});

	it("normalizes case and whitespace before lookup", () => {
		expect(translateCaption("  Front Page ")).toBe("Pagina Principale");
	});

	it("returns null for unknown captions", () => {
		expect(translateCaption("no-such-caption")).toBeNull();
		expect(translateCaption("")).toBeNull();
	});
});

describe("CATALOG_IT", () => {
	it("keys are lowercased English captions", () => {
		for (const key of Object.keys(CATALOG_IT)) {
			expect(key.toLowerCase()).toBe(key);
			expect(key.trim()).toBe(key);
		}
	});

	it("has Italian values (non-empty)", () => {
		for (const value of Object.values(CATALOG_IT)) {
			expect(value.length).toBeGreaterThan(0);
		}
	});

	it("covers core categories", () => {
		expect(CATALOG_IT.frontpage).toBe("Pagina Principale");
		expect(CATALOG_IT.hc).toBe("Club Habbo");
		expect(CATALOG_IT.christmas).toBe("Natale");
	});
});
