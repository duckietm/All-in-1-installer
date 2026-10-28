"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	db,
	WebsitePoll,
	WebsitePollQuestion,
	WebsitePollVote,
} from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { adminAction, authAction } from "@/lib/safe-action";
import { ActionError, actionError, actionOk } from "@/lib/safe-action-shared";
import { logAudit } from "@/lib/services/audit";
import { notify } from "@/lib/services/webhook";
import {
	createPollSchema,
	pollQuestionSchema,
	updatePollSchema,
	voteOnPollSchema,
} from "@/lib/validators/poll";

// ── Polls ───────────────────────────────────────────────────────────

export const createPoll = adminAction(
	{ permission: PERMS.POLLS_EDIT, schema: createPollSchema },
	async (ctx) => {
		const now = new Date();
		const [result] = await db.insert(WebsitePoll).values({
			...ctx.data,
			updatedAt: now,
		});
		const pollId = Number(result.insertId);
		logAudit({
			userId: ctx.session.user.id,
			action: "poll_create",
			target: "WebsitePoll",
			targetId: pollId,
			after: { title: ctx.data.title },
		});
		notify({
			action: "poll_create",
			actor: ctx.session.user.username,
			target: ctx.data.title,
		});
		return actionOk({ id: pollId });
	},
);

const updatePollInput = updatePollSchema.extend({
	id: z.coerce.number().int().positive(),
});

export const updatePoll = adminAction(
	{ permission: PERMS.POLLS_EDIT, schema: updatePollInput },
	async (ctx) => {
		const { id, ...data } = ctx.data;
		const [existing] = await db
			.select({
				id: WebsitePoll.id,
				title: WebsitePoll.title,
				status: WebsitePoll.status,
			})
			.from(WebsitePoll)
			.where(eq(WebsitePoll.id, id))
			.limit(1);
		if (!existing) throw new ActionError("Poll not found");

		await db
			.update(WebsitePoll)
			.set({ ...data, updatedAt: new Date() })
			.where(eq(WebsitePoll.id, id));
		logAudit({
			userId: ctx.session.user.id,
			action: "poll_update",
			target: "WebsitePoll",
			targetId: id,
			before: { title: existing.title, status: existing.status },
			after: data,
		});
		return actionOk({ id });
	},
);

const deletePollInput = z.object({
	id: z.coerce.number().int().positive(),
});

export const deletePoll = adminAction(
	{ permission: PERMS.POLLS_EDIT, schema: deletePollInput },
	async (ctx) => {
		const [existing] = await db
			.select({ id: WebsitePoll.id, title: WebsitePoll.title })
			.from(WebsitePoll)
			.where(eq(WebsitePoll.id, ctx.data.id))
			.limit(1);
		if (!existing) throw new ActionError("Poll not found");

		await db.delete(WebsitePoll).where(eq(WebsitePoll.id, ctx.data.id));
		logAudit({
			userId: ctx.session.user.id,
			action: "poll_delete",
			target: "WebsitePoll",
			targetId: ctx.data.id,
			before: { title: existing.title },
		});
		return actionOk();
	},
);

// ── Questions ───────────────────────────────────────────────────────

export const addPollQuestion = adminAction(
	{ permission: PERMS.POLLS_EDIT, schema: pollQuestionSchema },
	async (ctx) => {
		const [result] = await db.insert(WebsitePollQuestion).values(ctx.data);
		return actionOk({ id: Number(result.insertId) });
	},
);

const updateQuestionInput = pollQuestionSchema.partial().extend({
	id: z.coerce.number().int().positive(),
});

export const updatePollQuestion = adminAction(
	{ permission: PERMS.POLLS_EDIT, schema: updateQuestionInput },
	async (ctx) => {
		const { id, ...data } = ctx.data;
		await db
			.update(WebsitePollQuestion)
			.set(data)
			.where(eq(WebsitePollQuestion.id, id));
		return actionOk({ id });
	},
);

const deleteQuestionInput = z.object({
	id: z.coerce.number().int().positive(),
});

export const deletePollQuestion = adminAction(
	{ permission: PERMS.POLLS_EDIT, schema: deleteQuestionInput },
	async (ctx) => {
		await db
			.delete(WebsitePollQuestion)
			.where(eq(WebsitePollQuestion.id, ctx.data.id));
		return actionOk();
	},
);

// ── Public site: vote ───────────────────────────────────────────────

function parsePollOptions(options: string): string[] {
	return options
		.split("\n")
		.map((o) => o.trim())
		.filter(Boolean);
}

export const voteOnPoll = authAction(
	{
		schema: voteOnPollSchema,
		rateLimitKey: "poll-vote",
		rateLimitMax: 20,
		rateLimitWindowMs: 60_000,
	},
	async (ctx) => {
		const userId = Number(ctx.session.user.id);
		if (!Number.isInteger(userId) || userId <= 0) {
			return actionError("Unauthorized");
		}

		const [poll] = await db
			.select({
				id: WebsitePoll.id,
				status: WebsitePoll.status,
				startsAt: WebsitePoll.startsAt,
				endsAt: WebsitePoll.endsAt,
			})
			.from(WebsitePoll)
			.where(eq(WebsitePoll.id, ctx.data.pollId))
			.limit(1);

		if (!poll) return actionError("Poll not found");
		if (poll.status !== "active") {
			return actionError("This poll is not open for voting");
		}
		const now = Date.now();
		if (poll.startsAt && poll.startsAt.getTime() > now) {
			return actionError("This poll has not started yet");
		}
		if (poll.endsAt && poll.endsAt.getTime() < now) {
			return actionError("This poll has ended");
		}

		const questions = await db
			.select({
				id: WebsitePollQuestion.id,
				pollId: WebsitePollQuestion.pollId,
				type: WebsitePollQuestion.type,
				options: WebsitePollQuestion.options,
			})
			.from(WebsitePollQuestion)
			.where(eq(WebsitePollQuestion.pollId, poll.id));

		const questionById = new Map(questions.map((q) => [q.id, q]));
		const seen = new Set<number>();

		for (const vote of ctx.data.votes) {
			if (seen.has(vote.questionId)) {
				return actionError("Duplicate vote for the same question");
			}
			seen.add(vote.questionId);

			const question = questionById.get(vote.questionId);
			if (!question || question.pollId !== poll.id) {
				return actionError("Invalid question for this poll");
			}

			const answer = vote.answer.trim();
			if (!answer) return actionError("Answer is required");

			if (question.type === "text") {
				if (answer.length > 500) {
					return actionError("Answer is too long");
				}
			} else {
				const options = parsePollOptions(question.options);
				if (question.type === "multiple") {
					const selected = answer
						.split("\n")
						.map((a) => a.trim())
						.filter(Boolean);
					if (selected.length === 0) {
						return actionError("Select at least one option");
					}
					if (selected.some((a) => !options.includes(a))) {
						return actionError("Invalid option selected");
					}
				} else if (!options.includes(answer)) {
					return actionError("Invalid option selected");
				}
			}

			const [existing] = await db
				.select({ id: WebsitePollVote.id })
				.from(WebsitePollVote)
				.where(
					and(
						eq(WebsitePollVote.questionId, vote.questionId),
						eq(WebsitePollVote.userId, userId),
					),
				)
				.limit(1);
			if (existing) {
				return actionError("You have already voted on this poll");
			}
		}

		await db.transaction(async (tx) => {
			for (const vote of ctx.data.votes) {
				await tx.insert(WebsitePollVote).values({
					questionId: vote.questionId,
					userId,
					answer: vote.answer.trim(),
				});
			}
		});

		revalidatePath("/polls");
		revalidatePath(`/polls/${poll.id}`);
		return actionOk({ pollId: poll.id });
	},
);
