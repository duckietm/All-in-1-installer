import { describe, expect, it } from "vitest";
import {
	numericValue,
	offerPatchSchema,
	parseFurnitureIds,
} from "./offer-input";

describe("offer compatibility", () => {
	it.each([0, "0", -1, "-1"])(
		"preserves explicit numeric value %s",
		(value) => {
			expect(numericValue(value, 99)).toBe(Number(value));
		},
	);
	it.each([null, undefined, "", "invalid", Infinity])(
		"defaults missing or invalid value %s",
		(value) => {
			expect(numericValue(value, 99)).toBe(99);
		},
	);
	it("preserves bundle multiplicity and LTD/special offer values", () => {
		expect(parseFurnitureIds("12;23;12")).toEqual([12, 23, 12]);
		const values = {
			itemIds: "12;23;12",
			amount: 1,
			offerId: -1,
			orderNumber: 0,
			limitedSells: 4,
			limitedStack: 20,
			songId: 0,
			extradata: "a;b",
			haveOffer: "0",
			clubOnly: "1",
		};
		expect(offerPatchSchema.parse(values)).toEqual(values);
	});
	it.each(["1;0", "1;2x", "1;;2", "-1", "1.5"])(
		"rejects invalid furniture references %s",
		(value) => {
			expect(() => parseFurnitureIds(value)).toThrow();
		},
	);
	it("rejects invalid page ids and nonfinite prices without changing field meaning", () => {
		expect(offerPatchSchema.safeParse({ pageId: 0 }).success).toBe(false);
		expect(offerPatchSchema.safeParse({ costCredits: Infinity }).success).toBe(
			false,
		);
		expect(offerPatchSchema.parse({ offerId: 0, amount: 1 })).toEqual({
			offerId: 0,
			amount: 1,
		});
	});
});
describe("emulator offer constraints", () => {
	it("rejects negative costCredits and costPoints", () => {
		expect(offerPatchSchema.safeParse({ costCredits: -1 }).success).toBe(false);
		expect(offerPatchSchema.safeParse({ costPoints: -5 }).success).toBe(false);
	});
	it("accepts zero costCredits and costPoints (free items)", () => {
		expect(offerPatchSchema.parse({ costCredits: 0, costPoints: 0 })).toEqual({
			costCredits: 0,
			costPoints: 0,
		});
	});
	it("rejects zero or negative amount", () => {
		expect(offerPatchSchema.safeParse({ amount: 0 }).success).toBe(false);
		expect(offerPatchSchema.safeParse({ amount: -1 }).success).toBe(false);
	});
	it("accepts positive amount", () => {
		expect(offerPatchSchema.parse({ amount: 1 })).toEqual({ amount: 1 });
	});
	it("rejects unsupported pointsType values", () => {
		expect(offerPatchSchema.safeParse({ pointsType: 101 }).success).toBe(false);
		expect(offerPatchSchema.safeParse({ pointsType: 103 }).success).toBe(false);
		expect(offerPatchSchema.safeParse({ pointsType: -1 }).success).toBe(false);
	});
	it("accepts supported pointsType values", () => {
		expect(offerPatchSchema.parse({ pointsType: 0 })).toEqual({
			pointsType: 0,
		});
		expect(offerPatchSchema.parse({ pointsType: 5 })).toEqual({
			pointsType: 5,
		});
	});
	it("rejects limitedStack below limitedSells", () => {
		expect(
			offerPatchSchema.safeParse({ limitedStack: 0, limitedSells: 1 }).success,
		).toBe(false);
		expect(
			offerPatchSchema.safeParse({ limitedStack: 5, limitedSells: 10 }).success,
		).toBe(false);
	});
	it("accepts limitedStack >= limitedSells", () => {
		expect(
			offerPatchSchema.parse({ limitedStack: 10, limitedSells: 5 }),
		).toEqual({ limitedStack: 10, limitedSells: 5 });
		expect(
			offerPatchSchema.parse({ limitedStack: 0, limitedSells: 0 }),
		).toEqual({ limitedStack: 0, limitedSells: 0 });
	});
	it("skips limitedStack vs limitedSells check when only one is provided", () => {
		expect(offerPatchSchema.parse({ limitedStack: 0 })).toEqual({
			limitedStack: 0,
		});
		expect(offerPatchSchema.parse({ limitedSells: 5 })).toEqual({
			limitedSells: 5,
		});
	});
});
