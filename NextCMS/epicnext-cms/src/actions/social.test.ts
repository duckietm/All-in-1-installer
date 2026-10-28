// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

type Queue = Array<Array<Record<string, unknown>>>;

const state = vi.hoisted(() => ({
	auth: vi.fn(async () => ({ user: { id: "5" } })),
	rateLimit: vi.fn(async () => ({ ok: true })),
	clientIp: vi.fn(async () => "203.0.113.9"),
	revalidatePath: vi.fn(),
	insert: vi.fn(async () => [{ insertId: 500 }]),
	update: vi.fn(async () => [{ affectedRows: 1 }]),
	transaction: vi.fn(),
	selectQueue: [] as Queue,
	rows: [] as Array<Record<string, unknown>>,
	failInsert: false,
	isAllowed: vi.fn(async () => ({ ok: true })),
}));

// The real moderation module loads the word filter through the (mocked) db
// select queue, which would shift the rows the forum assertions rely on.
vi.mock("@/lib/services/moderation", () => ({ isAllowed: state.isAllowed }));

vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));
vi.mock("next/navigation", () => ({
	redirect: (path: string) => {
		throw Object.assign(new Error(path), { digest: `NEXT_REDIRECT:${path}` });
	},
}));
vi.mock("@/lib/auth", () => ({ auth: state.auth }));
vi.mock("@/lib/rate-limit", () => ({
	rateLimit: state.rateLimit,
	clientIp: state.clientIp,
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb(() => {
		if (state.selectQueue.length)
			return state.selectQueue.shift() as Queue[number];
		return state.rows;
	});
	const db = {
		...fake,
		insert: (table: unknown) => ({
			values: (values: unknown) =>
				state.failInsert
					? Promise.reject(new Error("db down"))
					: state.insert(table, values),
		}),
		update: (table: unknown) => ({
			set: (values: unknown) => ({
				where: (where: unknown) => state.update(table, values, where),
			}),
		}),
		transaction: (fn: (tx: unknown) => Promise<unknown>) =>
			state.transaction(fn, db),
	};
	return { ...schema, db };
});

import {
	GuildsForumsComments,
	GuildsForumsThreads,
	MessengerFriendrequests,
} from "@/lib/db";
import { postThread, replyToThread, sendFriendRequest } from "./social";

function friendForm(overrides: Record<string, string | undefined> = {}) {
	const f = new FormData();
	f.set("username", "Bob");
	f.set("userId", "9");
	for (const [k, v] of Object.entries(overrides)) {
		if (v === undefined) f.delete(k);
		else f.set(k, v);
	}
	return f;
}

function threadForm(overrides: Record<string, string | undefined> = {}) {
	const f = new FormData();
	f.set("guildId", "10");
	f.set("subject", "Welcome thread");
	f.set("message", "Hello from the community");
	for (const [k, v] of Object.entries(overrides)) {
		if (v === undefined) f.delete(k);
		else f.set(k, v);
	}
	return f;
}

function replyForm(overrides: Record<string, string | undefined> = {}) {
	const f = new FormData();
	f.set("guildId", "10");
	f.set("threadId", "20");
	f.set("message", "A thoughtful reply");
	for (const [k, v] of Object.entries(overrides)) {
		if (v === undefined) f.delete(k);
		else f.set(k, v);
	}
	return f;
}

describe("sendFriendRequest", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.auth.mockResolvedValue({ user: { id: "5" } });
		state.rateLimit.mockResolvedValue({ ok: true });
		state.insert.mockResolvedValue([{ insertId: 1 }]);
		state.failInsert = false;
		state.selectQueue = [];
		state.rows = [];
	});

	it("inserts a friend request and redirects to the profile with friend=sent", async () => {
		await expect(sendFriendRequest(friendForm())).rejects.toThrow(
			"/u/Bob?friend=sent",
		);
		expect(state.rateLimit).toHaveBeenCalledWith("friend:5", 5, 60_000);
		expect(state.insert).toHaveBeenCalledOnce();
		expect(state.insert.mock.calls[0][0]).toBe(MessengerFriendrequests);
		expect(state.insert.mock.calls[0][1]).toEqual({
			userFromId: 5,
			userToId: 9,
		});
		expect(state.revalidatePath).toHaveBeenCalledWith("/u/Bob");
		expect(state.revalidatePath).toHaveBeenCalledWith("/messages");
	});

	it("redirects to the root path when no username is supplied", async () => {
		await expect(
			sendFriendRequest(friendForm({ username: "" })),
		).rejects.toThrow("/?friend=sent");
		expect(state.revalidatePath).toHaveBeenCalledWith("/messages");
	});

	it("rejects a missing or non-positive target user id as invalid", async () => {
		await expect(
			sendFriendRequest(friendForm({ userId: "abc" })),
		).rejects.toThrow("/u/Bob?error=invalid");
		await expect(
			sendFriendRequest(friendForm({ userId: "0" })),
		).rejects.toThrow("/u/Bob?error=invalid");
		await expect(
			sendFriendRequest(friendForm({ userId: "5.5" })),
		).rejects.toThrow("/u/Bob?error=invalid");
		await expect(
			sendFriendRequest(friendForm({ userId: undefined })),
		).rejects.toThrow("/u/Bob?error=invalid");
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("blocks sending a request to yourself", async () => {
		await expect(
			sendFriendRequest(friendForm({ userId: "5" })),
		).rejects.toThrow("/u/Bob?error=self");
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("reports already_friends when a friendship exists either way", async () => {
		state.selectQueue = [[], [], [{ id: 1 }]];
		await expect(sendFriendRequest(friendForm())).rejects.toThrow(
			"/u/Bob?error=already_friends",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("reports already_pending when an outbound request exists", async () => {
		state.selectQueue = [[{ id: 1 }], [], []];
		await expect(sendFriendRequest(friendForm())).rejects.toThrow(
			"/u/Bob?error=already_pending",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("reports incoming_pending when the target already asked you", async () => {
		state.selectQueue = [[], [{ id: 2 }], []];
		await expect(sendFriendRequest(friendForm())).rejects.toThrow(
			"/u/Bob?error=incoming_pending",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("redirects with error=ratelimit when throttled", async () => {
		state.rateLimit.mockResolvedValue({ ok: false, retryAfter: 9 });
		await expect(sendFriendRequest(friendForm())).rejects.toThrow(
			"/u/Bob?error=ratelimit",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("redirects to /login when unauthenticated", async () => {
		state.auth.mockResolvedValue({ user: { id: undefined } });
		await expect(sendFriendRequest(friendForm())).rejects.toThrow("/login");
		state.auth.mockResolvedValue({ user: { id: "0" } });
		await expect(sendFriendRequest(friendForm())).rejects.toThrow("/login");
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("swallows write failures and redirects with error=error", async () => {
		state.failInsert = true;
		await expect(sendFriendRequest(friendForm())).rejects.toThrow(
			"/u/Bob?error=error",
		);
	});
});

describe("postThread", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.auth.mockResolvedValue({ user: { id: "5" } });
		state.rateLimit.mockResolvedValue({ ok: true });
		state.insert.mockResolvedValue([{ insertId: 500 }]);
		state.update.mockResolvedValue([{ affectedRows: 1 }]);
		state.failInsert = false;
		state.selectQueue = [];
		state.rows = [];
		state.isAllowed.mockResolvedValue({ ok: true });
		state.transaction.mockImplementation(
			async (fn: (tx: unknown) => Promise<unknown>, txDb: unknown) => fn(txDb),
		);
	});

	it("creates a thread plus its opening comment and redirects to the forum", async () => {
		state.selectQueue = [[{ id: 10 }]];
		await expect(postThread(threadForm())).rejects.toThrow(
			"/guilds/10/forum?posted=1",
		);
		expect(state.rateLimit).toHaveBeenCalledWith("forum:5", 3, 60_000);
		expect(state.insert).toHaveBeenCalledTimes(2);
		expect(state.insert.mock.calls[0][0]).toBe(GuildsForumsThreads);
		expect(state.insert.mock.calls[0][1]).toMatchObject({
			guildId: 10,
			openerId: 5,
			subject: "Welcome thread",
			postsCount: 1,
			state: 0,
			pinned: 0,
			locked: 0,
			adminId: 0,
		});
		expect(state.insert.mock.calls[1][0]).toBe(GuildsForumsComments);
		expect(state.insert.mock.calls[1][1]).toMatchObject({
			threadId: 500,
			userId: 5,
			message: "Hello from the community",
			state: 0,
		});
		expect(state.revalidatePath).toHaveBeenCalledWith("/guilds/10/forum");
	});

	it("truncates the subject and message to their bounds", async () => {
		state.selectQueue = [[{ id: 10 }]];
		await expect(
			postThread(
				threadForm({
					subject: "S".repeat(300),
					message: "M".repeat(12000),
				}),
			),
		).rejects.toThrow("/guilds/10/forum?posted=1");
		const subject = state.insert.mock.calls[0][1] as { subject: string };
		const message = state.insert.mock.calls[1][1] as { message: string };
		expect(subject.subject).toHaveLength(255);
		expect(message.message).toHaveLength(10000);
	});

	it("rejects an empty subject or message as invalid", async () => {
		await expect(postThread(threadForm({ subject: "" }))).rejects.toThrow(
			"/guilds/10/forum/new?error=invalid",
		);
		await expect(postThread(threadForm({ message: " " }))).rejects.toThrow(
			"/guilds/10/forum/new?error=invalid",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("rejects a missing or non-positive guild id as invalid", async () => {
		await expect(postThread(threadForm({ guildId: "abc" }))).rejects.toThrow(
			"/guilds/new?error=invalid",
		);
		await expect(postThread(threadForm({ guildId: "0" }))).rejects.toThrow(
			"/guilds/new?error=invalid",
		);
		await expect(postThread(threadForm({ guildId: "5.5" }))).rejects.toThrow(
			"/guilds/new?error=invalid",
		);
		expect(state.revalidatePath).not.toHaveBeenCalled();
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("rejects content blocked by the word filter before hitting the db", async () => {
		state.isAllowed.mockResolvedValue({ ok: false, reason: "bad" });
		state.selectQueue = [[{ id: 10 }]];
		await expect(postThread(threadForm())).rejects.toThrow(
			"/guilds/10/forum/new?error=invalid",
		);
		expect(state.isAllowed).toHaveBeenCalledWith(
			"Welcome thread Hello from the community",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("reports not_found when the guild does not exist", async () => {
		state.selectQueue = [[]];
		await expect(postThread(threadForm())).rejects.toThrow(
			"/guilds/10/forum/new?error=not_found",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("redirects with error=ratelimit when throttled", async () => {
		state.rateLimit.mockResolvedValue({ ok: false, retryAfter: 4 });
		await expect(postThread(threadForm())).rejects.toThrow(
			"/guilds/10/forum/new?error=ratelimit",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("redirects to /login when unauthenticated", async () => {
		state.auth.mockResolvedValue({ user: { id: undefined } });
		await expect(postThread(threadForm())).rejects.toThrow("/login");
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("swallows transaction failures and redirects with error=error", async () => {
		state.selectQueue = [[{ id: 10 }]];
		state.transaction.mockRejectedValue(new Error("tx abort"));
		await expect(postThread(threadForm())).rejects.toThrow(
			"/guilds/10/forum/new?error=error",
		);
	});
});

describe("replyToThread", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.auth.mockResolvedValue({ user: { id: "5" } });
		state.rateLimit.mockResolvedValue({ ok: true });
		state.insert.mockResolvedValue([{ insertId: 1 }]);
		state.update.mockResolvedValue([{ affectedRows: 1 }]);
		state.failInsert = false;
		state.selectQueue = [];
		state.rows = [];
		state.isAllowed.mockResolvedValue({ ok: true });
		state.transaction.mockImplementation(
			async (fn: (tx: unknown) => Promise<unknown>, txDb: unknown) => fn(txDb),
		);
	});

	it("appends a comment and bumps the thread counter", async () => {
		state.selectQueue = [[{ id: 20, locked: 0, postsCount: 3 }]];
		await expect(replyToThread(replyForm())).rejects.toThrow(
			"/guilds/10/forum/20?replied=1",
		);
		expect(state.rateLimit).toHaveBeenCalledWith("forum-reply:5", 5, 60_000);
		expect(state.insert).toHaveBeenCalledOnce();
		expect(state.insert.mock.calls[0][0]).toBe(GuildsForumsComments);
		expect(state.insert.mock.calls[0][1]).toMatchObject({
			threadId: 20,
			userId: 5,
			message: "A thoughtful reply",
			state: 0,
		});
		expect(state.update).toHaveBeenCalledOnce();
		expect(state.update.mock.calls[0][0]).toBe(GuildsForumsThreads);
		expect(state.update.mock.calls[0][1]).toMatchObject({
			postsCount: 4,
			updatedAt: expect.any(Number),
		});
		expect(state.revalidatePath).toHaveBeenCalledWith("/guilds/10/forum");
		expect(state.revalidatePath).toHaveBeenCalledWith("/guilds/10/forum/20");
	});

	it("floors a null posts_count at one", async () => {
		state.selectQueue = [[{ id: 20, locked: 0, postsCount: null }]];
		await expect(replyToThread(replyForm())).rejects.toThrow(
			"/guilds/10/forum/20?replied=1",
		);
		expect(state.update.mock.calls[0][1]).toMatchObject({ postsCount: 1 });
	});

	it("rejects a reply blocked by the word filter before hitting the db", async () => {
		state.isAllowed.mockResolvedValue({ ok: false, reason: "bad" });
		state.selectQueue = [[{ id: 20, locked: 0, postsCount: 3 }]];
		await expect(replyToThread(replyForm())).rejects.toThrow(
			"/guilds/10/forum/20?error=invalid",
		);
		expect(state.isAllowed).toHaveBeenCalledWith("A thoughtful reply");
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("rejects missing or non-positive ids by redirecting to /guilds", async () => {
		await expect(replyToThread(replyForm({ guildId: "abc" }))).rejects.toThrow(
			"/guilds",
		);
		await expect(replyToThread(replyForm({ threadId: "0" }))).rejects.toThrow(
			"/guilds",
		);
		expect(state.insert).not.toHaveBeenCalled();
		expect(state.revalidatePath).not.toHaveBeenCalled();
	});

	it("reports not_found when the thread does not match the guild", async () => {
		state.selectQueue = [[]];
		await expect(replyToThread(replyForm())).rejects.toThrow(
			"/guilds/10/forum/20?error=not_found",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("rejects replies to locked threads", async () => {
		state.selectQueue = [[{ id: 20, locked: 1, postsCount: 3 }]];
		await expect(replyToThread(replyForm())).rejects.toThrow(
			"/guilds/10/forum/20?error=locked",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("rejects an empty message as invalid on the thread page", async () => {
		await expect(replyToThread(replyForm({ message: "" }))).rejects.toThrow(
			"/guilds/10/forum/20?error=invalid",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("redirects with error=ratelimit when throttled", async () => {
		state.rateLimit.mockResolvedValue({ ok: false, retryAfter: 3 });
		await expect(replyToThread(replyForm())).rejects.toThrow(
			"/guilds/10/forum/20?error=ratelimit",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("redirects to /login when unauthenticated", async () => {
		state.auth.mockResolvedValue({ user: { id: undefined } });
		await expect(replyToThread(replyForm())).rejects.toThrow("/login");
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("swallows transaction failures and redirects with error=error", async () => {
		state.selectQueue = [[{ id: 20, locked: 0, postsCount: 3 }]];
		state.transaction.mockRejectedValue(new Error("tx abort"));
		await expect(replyToThread(replyForm())).rejects.toThrow(
			"/guilds/10/forum/20?error=error",
		);
	});
});
