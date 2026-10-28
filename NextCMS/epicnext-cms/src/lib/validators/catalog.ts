import { z } from "zod";

export const translateItemsSchema = z.object({
	items: z
		.array(
			z.object({
				id: z.coerce.number().int().positive(),
				publicName: z.string().min(1, "Name is required").max(255),
				description: z.string().max(1000).optional().default(""),
			}),
		)
		.min(1, "At least one item required")
		.max(500),
});

export type TranslateItemsInput = z.infer<typeof translateItemsSchema>;
