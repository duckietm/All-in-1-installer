// @ts-nocheck
import { describe, expect, it } from "vitest";
import { CurrencyType, currencyLabel } from "./currency";

describe("CurrencyType", () => {
	it("keeps emulator-dictated numeric values", () => {
		expect(CurrencyType.Credits).toBe(-1);
		expect(CurrencyType.Duckets).toBe(0);
		expect(CurrencyType.Diamonds).toBe(5);
		expect(CurrencyType.Points).toBe(101);
	});
});

describe("currencyLabel", () => {
	it("returns friendly labels for each currency", () => {
		expect(currencyLabel(CurrencyType.Credits)).toBe("Credits");
		expect(currencyLabel(CurrencyType.Duckets)).toBe("Duckets");
		expect(currencyLabel(CurrencyType.Diamonds)).toBe("Diamonds");
		expect(currencyLabel(CurrencyType.Points)).toBe("Points");
	});
});
