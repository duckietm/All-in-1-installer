import { expect, it } from "vitest";
import { bulkOfferInputSchema, projectBulkOffer } from "./bulk-offers";

const row = { pageId: 4, costCredits: 3, costPoints: 10, pointsType: 5 };
it("combines selected changes, rounds percentages, preserves explicit zero", () => {
	expect(
		projectBulkOffer(row, {
			costCredits: { mode: "set", value: 0 },
			costPoints: { mode: "percent", value: 25 },
			pageId: 9,
		}),
	).toEqual({ ...row, costCredits: 0, costPoints: 13, pageId: 9 });
});
it("rejects negative results and integer overflow instead of silently clamping", () => {
	expect(() =>
		projectBulkOffer(row, { costCredits: { mode: "add", value: -4 } }),
	).toThrow();
	expect(() =>
		projectBulkOffer(row, { costCredits: { mode: "set", value: 2147483648 } }),
	).toThrow();
});
it("leaves legacy signed fields untouched when changing a different field", () => {
	expect(
		projectBulkOffer({ ...row, costCredits: -1 }, { pageId: 5 }).costCredits,
	).toBe(-1);
});
it("rejects empty, duplicate, oversized selections and unknown mutations", () => {
	for (const input of [
		{ ids: [], changes: { pageId: 1 } },
		{ ids: [1, 1], changes: { pageId: 1 } },
		{
			ids: Array.from({ length: 501 }, (_, i) => i + 1),
			changes: { pageId: 1 },
		},
		{ ids: [1], changes: {} },
		{ ids: [1], changes: { itemIds: "2" } },
	])
		expect(() => bulkOfferInputSchema.parse(input)).toThrow();
});
it("rejects fractional set/add prices, accepts percentage discounts", () => {
	expect(() =>
		bulkOfferInputSchema.parse({
			ids: [1],
			changes: { costCredits: { mode: "set", value: 1.5 } },
		}),
	).toThrow();
	expect(
		projectBulkOffer(row, { costPoints: { mode: "percent", value: -50 } })
			.costPoints,
	).toBe(5);
});
it("rejects unsupported pointsType values in bulk changes", () => {
	expect(() =>
		bulkOfferInputSchema.parse({
			ids: [1],
			changes: { pointsType: 101 },
		}),
	).toThrow(/not supported/i);
});
it("accepts supported pointsType values in bulk changes", () => {
	expect(
		bulkOfferInputSchema.parse({
			ids: [1],
			changes: { pointsType: 5 },
		}),
	).toEqual({
		ids: [1],
		changes: { pointsType: 5 },
	});
});
