import { z } from "zod";

export const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000;
const text = z.string().max(500_000);
export const articleRecoverySchema = z.object({
	title: z.string().max(255),
	slug: z.string().max(255),
	image: z.string().max(255),
	shortStory: z.string().max(255),
	fullStory: text,
	status: z.enum(["draft", "scheduled", "published"]),
	publishAt: z.string().max(255).default(""),
});
const optionalNumber = z
	.union([z.string().max(30), z.number().finite(), z.null()])
	.optional();
const date = z.union([z.string().datetime(), z.null()]).optional();
export const eventRecoverySchema = z.object({
	title: z.string().max(255),
	description: text,
	image: z.string().max(500).nullable().optional(),
	typeId: z.number().int().nonnegative(),
	status: z.enum(["draft", "published", "cancelled", "completed"]),
	isRecurring: z.number().int().min(0).max(1),
	recurrenceRule: z.string().max(255).nullable().optional(),
	maxPlayers: optionalNumber,
	roomId: optionalNumber,
	startsAt: date,
	endsAt: date,
});
export type RecoveryKind = "article" | "event";
export function recoveryKey(
	userId: string,
	kind: RecoveryKind,
	record: string,
) {
	return `cms:draft:v1:${encodeURIComponent(userId)}:${kind}:${encodeURIComponent(record)}`;
}
export function validateRecovery(
	kind: RecoveryKind,
	value: unknown,
): Record<string, unknown> {
	return (
		kind === "article" ? articleRecoverySchema : eventRecoverySchema
	).parse(value);
}
export function encodeRecovery(
	kind: RecoveryKind,
	value: unknown,
	now = Date.now(),
) {
	const raw = JSON.stringify({
		version: 1,
		savedAt: now,
		payload: validateRecovery(kind, value),
	});
	if (raw.length > 600_000) throw new Error("draftTooLarge");
	return raw;
}
export function decodeRecovery(
	kind: RecoveryKind,
	raw: string,
	now = Date.now(),
) {
	if (raw.length > 600_000) throw new Error("draftTooLarge");
	const envelope = z
		.object({
			version: z.literal(1),
			savedAt: z.number().int(),
			payload: z.unknown(),
		})
		.parse(JSON.parse(raw));
	if (envelope.savedAt > now + 60_000 || now - envelope.savedAt > DRAFT_TTL)
		throw new Error("draftExpired");
	return {
		savedAt: envelope.savedAt,
		payload: validateRecovery(kind, envelope.payload),
	};
}
