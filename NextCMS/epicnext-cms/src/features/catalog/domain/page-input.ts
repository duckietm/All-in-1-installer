import { z } from "zod";

const flag = z.enum(["0", "1"]);
const integer = z.number().int().min(-2147483648).max(2147483647);
export const pagePatchSchema = z.object({
	caption: z
		.string()
		.min(1)
		.max(128)
		.refine((value) => value.trim().length > 0, "Category name is required")
		.optional(),
	captionSave: z.string().max(25).optional(),
	parentId: integer.min(-1).optional(),
	pageLayout: z.string().min(1).max(26).optional(),
	enabled: flag.optional(),
	visible: flag.optional(),
	clubOnly: flag.optional(),
	vipOnly: flag.optional(),
	minRank: integer.min(0).optional(),
	orderNum: integer.optional(),
	iconImage: integer.min(0).optional(),
	iconColor: integer.min(0).optional(),
	pageHeadline: z.string().max(1024).optional(),
	pageTeaser: z.string().max(64).optional(),
	pageSpecial: z.string().max(2048).nullable().optional(),
	pageText1: z.string().nullable().optional(),
	pageText2: z.string().nullable().optional(),
	pageTextDetails: z.string().nullable().optional(),
	pageTextTeaser: z.string().nullable().optional(),
	includes: z.string().max(128).optional(),
});
