import { describe, expect, it } from "vitest";
import { parseCatalogSearch, validSearchQuery } from "./search";

describe("catalog search input", () => {
	it("allows a one digit ID but requires at least two text characters", () => {
		expect(validSearchQuery("7")).toBe(true);
		expect(validSearchQuery("a")).toBe(false);
		expect(validSearchQuery("  ab ")).toBe(true);
	});
	it("does not round oversized numeric identifiers", () => {
		expect(parseCatalogSearch("normal", "9007199254740992").numericId).toBe(
			null,
		);
	});
	it("escapes LIKE wildcard and escape characters", () => {
		expect(parseCatalogSearch("bc", "a_%=").pattern).toBe("a=_=%==%");
	});
});
