// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	polls: [] as any[],
	questions: [] as any[],
	votes: [] as any[],
	inserts: [] as Array<{ table: unknown; value: any }>,
	updates: [] as any[],
	deletes: [] as unknown[],
	nextId: 55,
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb((table) => {
		if (table === schema.WebsitePoll) return state.polls;
		if (table === schema.WebsitePollQuestion) return state.questions;
		if (table === schema.WebsitePollVote) return state.votes;
		return [];
	});
	const makeInsert = (table: unknown) => ({
		values: (value: any) => {
			state.inserts.push({ table, value });
			return Promise.resolve([{ insertId: state.nextId++ }]);
		},
	});
	return {
		...schema,
		db: {
			...fake,
			insert: (table: unknown) => makeInsert(table),
			update: (table: unknown) => ({
				set: (value: any) => {
					state.updates.push({ table, value });
					return { where: () => Promise.resolve([{ affectedRows: 1 }]) };
				},
			}),
			delete: (table: unknown) => ({
				where: () => {
					state.deletes.push(table);
					return Promise.resolve([{ affectedRows: 1 }]);
				},
			}),
			transaction: async (cb: (tx: any) => Promise<unknown>) =>
				cb({ insert: (table: unknown) => makeInsert(table) }),
		},
	};
});

const perm = vi.hoisted(() => ({ getCtx: vi.fn(), canAccess: vi.fn() }));
vi.mock("@/lib/permissions", async () => ({
	...(await import("@/lib/permission-slugs")),
	getApiAdminContext: perm.getCtx,
	canAccess: perm.canAccess,
}));

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: authMock }));

const rateLimitMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({
	rateLimit: rateLimitMock,
	clientIp: vi.fn().mockResolvedValue("127.0.0.1"),
}));
vi.mock("@/lib/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/services/staff-activity", () => ({ logStaffActivity: vi.fn() }));

const logAuditMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/audit", () => ({ logAudit: logAuditMock }));

const notifyMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/webhook", () => ({ notify: notifyMock }));

const revalidatePathMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import {
	addPollQuestion,
	createPoll,
	deletePoll,
	deletePollQuestion,
	updatePoll,
	updatePollQuestion,
	voteOnPoll,
} from "./polls";

const ctx = {
	session: { user: { id: 7, username: "admin", rank: 7, name: "admin" } },
	permissions: { has: () => true },
};

const activePoll = {
	id: 1,
	status: "active",
	startsAt: new Date(Date.now() - 60_000),
	endsAt: new Date(Date.now() + 60_000),
};

beforeEach(() => {
	vi.clearAllMocks();
	state.polls = [activePoll];
	state.questions = [
		{ id: 10, pollId: 1, type: "single", options: "A\nB" },
		{ id: 11, pollId: 1, type: "multiple", options: "A\nB" },
		{ id: 12, pollId: 1, type: "text", options: "ignored" },
	];
	state.votes = [];
	state.inserts = [];
	state.updates = [];
	state.deletes = [];
	state.nextId = 55;
	perm.getCtx.mockResolvedValue(ctx);
	perm.canAccess.mockReturnValue(true);
	authMock.mockResolvedValue({ user: { id: 7, name: "voter" } });
	rateLimitMock.mockResolvedValue({ ok: true, retryAfter: 0 });
	logAuditMock.mockResolvedValue(undefined);
	notifyMock.mockResolvedValue(undefined);
});

describe("voteOnPoll", () => {
	it("returns Unauthorized when there is no session", async () => {
		authMock.mockResolvedValue(null);
		const res = await voteOnPoll({
			pollId: 1,
			votes: [{ questionId: 10, answer: "A" }],
		});
		expect(res).toEqual({ ok: false, error: "Unauthorized" });
	});

	it("reports a rate limit", async () => {
		rateLimitMock.mockResolvedValue({ ok: false, retryAfter: 42 });
		const res = await voteOnPoll({
			pollId: 1,
			votes: [{ questionId: 10, answer: "A" }],
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toContain("Rate limited");
	});

	it("rejects a non-numeric session id", async () => {
		authMock.mockResolvedValue({ user: { id: "nope", name: "x" } });
		const res = await voteOnPoll({
			pollId: 1,
			votes: [{ questionId: 10, answer: "A" }],
		});
		expect(res).toEqual({ ok: false, error: "Unauthorized" });
	});

	it("validates the vote payload shape", async () => {
		expect((await voteOnPoll({ pollId: 1, votes: [] })).ok).toBe(false);
		expect((await voteOnPoll({ pollId: 0, votes: [] })).ok).toBe(false);
	});

	it("reports a missing poll", async () => {
		state.polls = [];
		const res = await voteOnPoll({
			pollId: 1,
			votes: [{ questionId: 10, answer: "A" }],
		});
		expect(res).toEqual({ ok: false, error: "Poll not found" });
	});

	it("rejects a non-active poll", async () => {
		state.polls = [{ ...activePoll, status: "closed" }];
		const res = await voteOnPoll({
			pollId: 1,
			votes: [{ questionId: 10, answer: "A" }],
		});
		expect(res).toEqual({
			ok: false,
			error: "This poll is not open for voting",
		});
	});

	it("rejects a poll that has not started", async () => {
		state.polls = [{ ...activePoll, startsAt: new Date(Date.now() + 60_000) }];
		const res = await voteOnPoll({
			pollId: 1,
			votes: [{ questionId: 10, answer: "A" }],
		});
		expect(res).toEqual({ ok: false, error: "This poll has not started yet" });
	});

	it("rejects a poll that has ended", async () => {
		state.polls = [{ ...activePoll, endsAt: new Date(Date.now() - 60_000) }];
		const res = await voteOnPoll({
			pollId: 1,
			votes: [{ questionId: 10, answer: "A" }],
		});
		expect(res).toEqual({ ok: false, error: "This poll has ended" });
	});

	it("rejects duplicate votes for the same question", async () => {
		const res = await voteOnPoll({
			pollId: 1,
			votes: [
				{ questionId: 10, answer: "A" },
				{ questionId: 10, answer: "B" },
			],
		});
		expect(res).toEqual({
			ok: false,
			error: "Duplicate vote for the same question",
		});
	});

	it("rejects a question that does not belong to the poll", async () => {
		state.questions = [{ id: 10, pollId: 2, type: "single", options: "A\nB" }];
		const res = await voteOnPoll({
			pollId: 1,
			votes: [{ questionId: 10, answer: "A" }],
		});
		expect(res).toEqual({
			ok: false,
			error: "Invalid question for this poll",
		});
	});

	it("rejects an unknown question id", async () => {
		state.questions = [];
		const res = await voteOnPoll({
			pollId: 1,
			votes: [{ questionId: 99, answer: "A" }],
		});
		expect(res).toEqual({
			ok: false,
			error: "Invalid question for this poll",
		});
	});

	it("rejects an empty answer", async () => {
		const res = await voteOnPoll({
			pollId: 1,
			votes: [{ questionId: 10, answer: "  " }],
		});
		expect(res).toEqual({ ok: false, error: "Answer is required" });
	});

	it("rejects a text answer over 500 characters at the schema layer", async () => {
		const res = await voteOnPoll({
			pollId: 1,
			votes: [{ questionId: 12, answer: "x".repeat(501) }],
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toBe("Validation failed");
	});

	it("rejects an invalid single-choice option", async () => {
		const res = await voteOnPoll({
			pollId: 1,
			votes: [{ questionId: 10, answer: "Z" }],
		});
		expect(res).toEqual({ ok: false, error: "Invalid option selected" });
	});

	it("rejects an invalid multiple-choice option", async () => {
		const res = await voteOnPoll({
			pollId: 1,
			votes: [{ questionId: 11, answer: "A\nZ" }],
		});
		expect(res).toEqual({ ok: false, error: "Invalid option selected" });
	});

	it("rejects a second vote by the same user", async () => {
		state.votes = [{ id: 1 }];
		const res = await voteOnPoll({
			pollId: 1,
			votes: [{ questionId: 10, answer: "A" }],
		});
		expect(res).toEqual({
			ok: false,
			error: "You have already voted on this poll",
		});
	});

	it("records valid single, multiple and text votes in one transaction", async () => {
		const res = await voteOnPoll({
			pollId: 1,
			votes: [
				{ questionId: 10, answer: "A" },
				{ questionId: 11, answer: "A\nB" },
				{ questionId: 12, answer: "  free text  " },
			],
		});
		expect(res).toEqual({ ok: true, data: { pollId: 1 } });
		expect(state.inserts).toHaveLength(3);
		expect(state.inserts[0].value).toEqual({
			questionId: 10,
			userId: 7,
			answer: "A",
		});
		expect(state.inserts[2].value.answer).toBe("free text");
		expect(revalidatePathMock).toHaveBeenCalledWith("/polls");
		expect(revalidatePathMock).toHaveBeenCalledWith("/polls/1");
	});
});

describe("poll administration", () => {
	it("creates a poll", async () => {
		const res = await createPoll({ title: "Favourite pet" });
		expect(res).toEqual({ ok: true, data: { id: 55 } });
		expect(state.inserts[0].value).toMatchObject({
			title: "Favourite pet",
			updatedAt: expect.any(Date),
		});
		expect(logAuditMock).toHaveBeenCalledWith(
			expect.objectContaining({ action: "poll_create", targetId: 55 }),
		);
		expect(notifyMock).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "poll_create",
				target: "Favourite pet",
			}),
		);
	});

	it("validates a poll title", async () => {
		expect((await createPoll({ title: "" })).ok).toBe(false);
	});

	it("updates an existing poll", async () => {
		const res = await updatePoll({ id: 1, title: "Renamed" });
		expect(res).toEqual({ ok: true, data: { id: 1 } });
		expect(state.updates[0].value).toMatchObject({ title: "Renamed" });
		expect(logAuditMock).toHaveBeenCalledWith(
			expect.objectContaining({ action: "poll_update" }),
		);
	});

	it("reports a missing poll on update", async () => {
		state.polls = [];
		const res = await updatePoll({ id: 1, title: "Renamed" });
		expect(res).toEqual({ ok: false, error: "Poll not found" });
	});

	it("deletes an existing poll", async () => {
		const res = await deletePoll({ id: 1 });
		expect(res).toEqual({ ok: true, data: {} });
		expect(state.deletes).toContainEqual(expect.anything());
		expect(logAuditMock).toHaveBeenCalledWith(
			expect.objectContaining({ action: "poll_delete" }),
		);
	});

	it("reports a missing poll on delete", async () => {
		state.polls = [];
		const res = await deletePoll({ id: 1 });
		expect(res).toEqual({ ok: false, error: "Poll not found" });
	});

	it("adds, updates and deletes questions", async () => {
		const added = await addPollQuestion({
			pollId: 1,
			question: "Why?",
			type: "single",
			sortOrder: 0,
			options: "A\nB",
		});
		expect(added).toEqual({ ok: true, data: { id: 55 } });

		const updated = await updatePollQuestion({ id: 10, question: "Changed" });
		expect(updated).toEqual({ ok: true, data: { id: 10 } });
		expect(state.updates.at(-1)?.value).toMatchObject({ question: "Changed" });

		const removed = await deletePollQuestion({ id: 10 });
		expect(removed).toEqual({ ok: true, data: {} });
	});

	it("requires the polls.edit permission", async () => {
		perm.getCtx.mockResolvedValue(null);
		expect(await createPoll({ title: "x" })).toEqual({
			ok: false,
			error: "Unauthorized",
		});
		perm.getCtx.mockResolvedValue(ctx);
		perm.canAccess.mockReturnValue(false);
		expect(await deletePoll({ id: 1 })).toEqual({
			ok: false,
			error: "Unauthorized",
		});
	});
});
