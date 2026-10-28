// @ts-nocheck
import { describe, expect, it } from "vitest";
import { classifyCatalogItem, isBadgeType, isPetClassname } from "./item-kind";

describe("isBadgeType", () => {
	it("recognizes type 'b' case-insensitively", () => {
		expect(isBadgeType("b")).toBe(true);
		expect(isBadgeType(" B ")).toBe(true);
		expect(isBadgeType("s")).toBe(false);
		expect(isBadgeType("")).toBe(false);
	});
});

describe("isPetClassname", () => {
	it("matches a0 pet<N> classnames", () => {
		expect(isPetClassname("a0 pet0")).toBe(true);
		expect(isPetClassname("a0 pet80")).toBe(true);
		expect(isPetClassname("A0 PET5")).toBe(true);
	});
	it("rejects non-pet classnames", () => {
		expect(isPetClassname("a0")).toBe(false);
		expect(isPetClassname("sofa")).toBe(false);
		expect(isPetClassname("")).toBe(false);
	});
});

describe("classifyCatalogItem", () => {
	const item = (
		overrides: Partial<Parameters<typeof classifyCatalogItem>[0]>,
	) =>
		classifyCatalogItem({
			type: "s",
			item_name: "sofa",
			interaction_type: null,
			...overrides,
		});

	it("classifies badges", () => {
		expect(item({ type: "b" })).toBe("badge");
	});
	it("classifies pets by classname or pet interaction", () => {
		expect(item({ item_name: "a0 pet7" })).toBe("pet");
		expect(item({ interaction_type: "pet3" })).toBe("pet");
	});
	it("classifies effects, bots and sticky by name", () => {
		expect(item({ item_name: "avatar_effect_12" })).toBe("effect");
		expect(item({ item_name: "bot_barry" })).toBe("bot");
		expect(item({ item_name: "rentable_bot_2" })).toBe("bot");
		expect(item({ item_name: "post_it" })).toBe("sticky");
		expect(item({ item_name: "postit" })).toBe("sticky");
	});
	it("classifies posters and currency furniture", () => {
		expect(item({ item_name: "poster100" })).toBe("poster");
		expect(item({ item_name: "poster5000" })).toBe("poster");
		expect(item({ item_name: "funtastic_four_poster" })).toBe("poster");
		expect(item({ item_name: "duckfountain" })).toBe("poster");
		expect(item({ item_name: "Swimming" })).toBe("poster");
		expect(item({ item_name: "CF_50000_Hucci" })).toBe("currency");
		expect(item({ item_name: "DF_102_10_bluechip" })).toBe("currency");
		expect(item({ item_name: "sofa" })).toBe("furni");
	});
	it("classifies everything else as furni", () => {
		expect(item({})).toBe("furni");
	});
});
