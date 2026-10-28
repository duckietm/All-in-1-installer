import { z } from "zod";

export const createPollSchema = z.object({
	title: z.string().min(1, "Title is required").max(255),
	description: z.string().max(2000).nullable().optional(),
	status: z.enum(["draft", "active", "closed"]).default("draft"),
	showResults: z.coerce.number().int().min(0).max(1).default(1),
	multipleChoice: z.coerce.number().int().min(0).max(1).default(0),
	startsAt: z.coerce.date().nullable().optional(),
	endsAt: z.coerce.date().nullable().optional(),
});

export const updatePollSchema = createPollSchema.partial();

export const pollQuestionSchema = z.object({
	pollId: z.coerce.number().int().positive(),
	question: z.string().min(1).max(500),
	type: z.enum(["single", "multiple", "text"]).default("single"),
	sortOrder: z.coerce.number().int().min(0).default(0),
	options: z.string().min(1, "Options are required"),
});

export const pollVoteSchema = z.object({
	questionId: z.coerce.number().int().positive(),
	answer: z.string().min(1).max(500),
});

export const voteOnPollSchema = z.object({
	pollId: z.coerce.number().int().positive(),
	votes: z.array(pollVoteSchema).min(1).max(50),
});

export type CreatePollInput = z.infer<typeof createPollSchema>;
export type UpdatePollInput = z.infer<typeof updatePollSchema>;
export type PollQuestionInput = z.infer<typeof pollQuestionSchema>;
export type PollVoteInput = z.infer<typeof pollVoteSchema>;
export type VoteOnPollInput = z.infer<typeof voteOnPollSchema>;
