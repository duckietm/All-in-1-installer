import { z } from "zod";

/** Convert empty strings to undefined so optional/nullable fields pass validation */
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

export const eventTypeSchema = z.object({
	name: z.string().min(1, "Name is required").max(100),
	slug: z
		.string()
		.min(1)
		.max(100)
		.regex(/^[a-z0-9-]+$/, "Slug must be lowercase with hyphens"),
	description: z.string().max(500).optional().default(""),
	color: z.string().max(20).optional().default("#3b82f6"),
	icon: z.string().max(50).optional().default("calendar"),
	isActive: z.coerce.number().int().min(0).max(1).default(1),
	minRank: z.coerce.number().int().min(0).max(7).default(0),
});

export const createEventSchema = z.object({
	title: z.string().min(1, "Title is required").max(255),
	description: z.string().min(1, "Description is required"),
	typeId: z.coerce.number().int().positive(),
	roomId: z.preprocess(
		emptyToUndefined,
		z.coerce.number().int().positive().nullable().optional(),
	),
	startsAt: z.preprocess(
		(value) =>
			value == null || typeof value === "boolean" ? undefined : value,
		z.coerce.date(),
	),
	endsAt: z.preprocess(emptyToUndefined, z.coerce.date().nullable().optional()),
	maxPlayers: z.preprocess(
		emptyToUndefined,
		z.coerce.number().int().positive().nullable().optional(),
	),
	isRecurring: z.coerce.number().int().min(0).max(1).default(0),
	recurrenceRule: z.preprocess(
		emptyToUndefined,
		z.string().max(255).nullable().optional(),
	),
	status: z
		.enum(["draft", "published", "cancelled", "completed"])
		.default("draft"),
	image: z.preprocess(
		emptyToUndefined,
		z.string().max(500).nullable().optional(),
	),
});

// Zod applies defaults inside optional schemas; partial edits must not reset state.
export const updateEventSchema = createEventSchema.partial().extend({
	status: createEventSchema.shape.status.removeDefault().optional(),
	isRecurring: createEventSchema.shape.isRecurring.removeDefault().optional(),
	image: z.preprocess(
		(value) => (value === "" ? null : value),
		z.string().max(500).nullable().optional(),
	),
});

export const eventPrizeSchema = z.object({
	eventId: z.coerce.number().int().positive(),
	position: z.coerce.number().int().positive().default(1),
	prizeType: z
		.enum(["badge", "credits", "pixels", "points", "item"])
		.default("badge"),
	badgeCode: z.string().max(50).nullable().optional(),
	credits: z.coerce.number().int().min(0).default(0),
	pixels: z.coerce.number().int().min(0).default(0),
	points: z.coerce.number().int().min(0).default(0),
	itemId: z.coerce.number().int().positive().nullable().optional(),
	description: z.string().max(255).optional().default(""),
});

export const eventWinnerSchema = z.object({
	eventId: z.coerce.number().int().positive(),
	userId: z.coerce.number().int().positive(),
	position: z.coerce.number().int().positive().default(1),
});

export const registerForEventSchema = z.object({
	eventId: z.coerce.number().int().positive(),
});

export type EventTypeInput = z.infer<typeof eventTypeSchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type EventPrizeInput = z.infer<typeof eventPrizeSchema>;
export type EventWinnerInput = z.infer<typeof eventWinnerSchema>;
export type RegisterForEventInput = z.infer<typeof registerForEventSchema>;
