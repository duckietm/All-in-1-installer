import { z } from "zod";
import { CatalogInputError } from "./hierarchy";
import {
	EMULATOR_POINTS_TYPES,
	offerIdSchema,
	offerInteger,
} from "./offer-input";

const priceChange = z
	.object({
		mode: z.enum(["set", "add", "percent"]),
		value: z.number().finite().min(-2147483648).max(2147483647),
	})
	.strict()
	.refine(
		(v) => v.mode === "percent" || Number.isInteger(v.value),
		"Set and add values must be whole numbers",
	);
export const bulkOfferChangesSchema = z
	.object({
		costCredits: priceChange.optional(),
		costPoints: priceChange.optional(),
		pointsType: offerInteger.nonnegative().optional(),
		pageId: offerIdSchema.optional(),
	})
	.strict()
	.refine(
		(v) => Object.values(v).some((x) => x !== undefined),
		"Choose at least one field to change",
	)
	.refine(
		(v) =>
			v.pointsType === undefined ||
			EMULATOR_POINTS_TYPES.includes(
				v.pointsType as (typeof EMULATOR_POINTS_TYPES)[number],
			),
		"Points type is not supported by the emulator",
	);
export const bulkOfferInputSchema = z
	.object({
		ids: z
			.array(offerIdSchema)
			.min(1)
			.max(500)
			.refine(
				(v) => new Set(v).size === v.length,
				"Selection contains duplicate offers",
			),
		changes: bulkOfferChangesSchema,
	})
	.strict();
export type BulkOfferInput = z.infer<typeof bulkOfferInputSchema>;
export type BulkOfferValues = {
	pageId: number;
	costCredits: number;
	costPoints: number;
	pointsType: number;
};
export type BulkOfferPreview = {
	fingerprint: string;
	changedCount: number;
	pages: Array<{ id: number; caption: string }>;
	rows: Array<{
		id: number;
		catalogName: string;
		before: BulkOfferValues;
		after: BulkOfferValues;
	}>;
};
export function projectBulkOffer(
	row: BulkOfferValues,
	changes: BulkOfferInput["changes"],
): BulkOfferValues {
	const after = { ...row };
	for (const key of ["costCredits", "costPoints"] as const) {
		const change = changes[key];
		if (!change) continue;
		const value =
			change.mode === "set"
				? change.value
				: change.mode === "add"
					? row[key] + change.value
					: Math.round(row[key] * (1 + change.value / 100));
		if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647)
			throw new CatalogInputError(
				"A resulting price is negative or exceeds the supported range",
			);
		after[key] = value;
	}
	if (changes.pointsType !== undefined) after.pointsType = changes.pointsType;
	if (changes.pageId !== undefined) after.pageId = changes.pageId;
	return after;
}
