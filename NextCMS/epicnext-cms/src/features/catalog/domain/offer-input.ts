import { z } from "zod";

export const offerInteger = z.number().int().min(-2147483648).max(2147483647);
export const offerIdSchema = offerInteger.positive();

/** Points-type values the Arcturus emulator accepts for catalog pricing. */
export const EMULATOR_POINTS_TYPES = [0, 5] as const;

/** Missing SQL values use the field default; explicit zero and special negatives survive. */
export function numericValue(value: unknown, fallback: number): number {
	if (value == null || (typeof value === "string" && value.trim() === ""))
		return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}
export function parseFurnitureIds(value: string): number[] {
	const parts = value.split(";");
	if (!parts.length || parts.some((part) => !/^\d+$/.test(part.trim())))
		throw Error("Invalid furniture references");
	return parts.map((part) => offerIdSchema.parse(Number(part)));
}
export const itemIds = z
	.string()
	.max(666)
	.refine((value) => {
		try {
			parseFurnitureIds(value);
			return true;
		} catch {
			return false;
		}
	}, "Invalid furniture references");
// Keep signed/special values on existing offer fields: bundle/LTD meaning belongs to the emulator.
export const offerPatchSchema = z
	.object({
		pageId: offerIdSchema.optional(),
		itemIds: itemIds.optional(),
		catalogName: z.string().max(100).optional(),
		costCredits: offerInteger.nonnegative().optional(),
		costPoints: offerInteger.nonnegative().optional(),
		pointsType: offerInteger.optional(),
		amount: offerInteger.positive().optional(),
		orderNumber: offerInteger.optional(),
		offerId: offerInteger.optional(),
		songId: z.number().int().min(0).max(4294967295).optional(),
		limitedSells: offerInteger.nonnegative().optional(),
		limitedStack: offerInteger.nonnegative().optional(),
		extradata: z.string().max(500).optional(),
		haveOffer: z.enum(["0", "1"]).optional(),
		clubOnly: z.enum(["0", "1"]).optional(),
	})
	.refine(
		(data) =>
			data.pointsType === undefined ||
			EMULATOR_POINTS_TYPES.includes(
				data.pointsType as (typeof EMULATOR_POINTS_TYPES)[number],
			),
		"Points type is not supported by the emulator",
	)
	.refine(
		(data) =>
			data.limitedStack === undefined ||
			data.limitedSells === undefined ||
			data.limitedStack >= data.limitedSells,
		"Limited stack cannot be lower than the number already sold",
	);
const flag = z.union([
	z.literal(0),
	z.literal(1),
	z.literal("0"),
	z.literal("1"),
]);
export const furniturePatchSchema = z.object({
	publicName: z.string().max(56).optional(),
	itemName: z.string().max(70).optional(),
	type: z.string().max(3).optional(),
	width: offerInteger.optional(),
	length: offerInteger.optional(),
	stackHeight: z.number().finite().optional(),
	allowStack: flag.optional(),
	allowSit: flag.optional(),
	allowLay: flag.optional(),
	allowWalk: flag.optional(),
	allowGift: flag.optional(),
	allowTrade: flag.optional(),
	allowRecycle: flag.optional(),
	allowMarketplaceSell: flag.optional(),
	allowInventoryStack: flag.optional(),
	interactionType: z.string().max(500).optional(),
	interactionModesCount: offerInteger.optional(),
	vendingIds: z.string().max(255).optional(),
	customparams: z.string().max(25600).optional(),
	effectIdMale: offerInteger.optional(),
	effectIdFemale: offerInteger.optional(),
	clothingOnWalk: z.string().max(255).optional(),
});
export function distinctOfferIds(ids: number[]): number[] {
	for (const id of ids) offerIdSchema.parse(id);
	if (new Set(ids).size !== ids.length)
		throw Error("Duplicate catalog item ids");
	return ids;
}
