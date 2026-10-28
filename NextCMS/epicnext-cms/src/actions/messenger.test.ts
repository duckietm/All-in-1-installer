// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeForm } from "@/test/fake-form";

const state = vi.hoisted(() => ({
	requests: [] as any[],
	friendships: [] as any[],
	users: [] as any[],
	inserts: [] as Array<{ table: unknown; value: any }>,
	deletes: [] as unknown[],
	affectedDelete: 1,
	emptyDeleteResult: false,
	isAllowed: vi.fn(async () => ({ ok: true })),
}));

// The real moderation module loads the word filter through the (mocked) db,
// which would silently change the rows the offline-message assertions read.
vi.mock("@/lib/services/moderation", () => ({ isAllowed: state.isAllowed }));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb((table) => {
		if (table === schema.MessengerFriendrequests) return state.requests;
		if (table === schema.MessengerFriendships) return state.friendships;
		if (table === schema.User) return state.users;
		return [];
	});
	const makeInsert = (table: unknown) => ({
		values: (value: any) => {
			state.inserts.push({ table, value });
			return Promise.resolve([{ insertId: 1 }]);
		},
	});
	const makeDelete = (table: unknown) => ({
		where: () => {
			state.deletes.push(table);
			return Promise.resolve(
				state.emptyDeleteResult ? [] : [{ affectedRows: state.affectedDelete }],
			);
		},
	});
	return {
		...schema,
		db: {
			...fake,
			insert: (table: unknown) => makeInsert(table),
			delete: (table: unknown) => makeDelete(table),
			transaction: async (cb: (tx: any) => Promise<unknown>) =>
				cb({
					...fake,
					insert: (table: unknown) => makeInsert(table),
					delete: (table: unknown) => makeDelete(table),
				}),
		},
	};
});

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: authMock }));

const clientIpMock = vi.hoisted(() => vi.fn());
const rateLimitMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({
	clientIp: clientIpMock,
	rateLimit: rateLimitMock,
}));

const revalidatePathMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
	redirect: (url: string) => {
		redirectMock(url);
		throw Object.assign(new Error("NEXT_REDIRECT"), {
			digest: `NEXT_REDIRECT;replace;${url};307;`,
		});
	},
}));

import {
	acceptFriend,
	declineFriendRequest,
	removeFriendship,
	sendOfflineMessage,
} from "./messenger";

const redirected = () => redirectMock.mock.calls.at(-1)?.[0];

beforeEach(() => {
	vi.clearAllMocks();
	state.requests = [];
	state.friendships = [];
	state.users = [{ id: 2 }];
	state.inserts = [];
	state.deletes = [];
	state.affectedDelete = 1;
	state.emptyDeleteResult = false;
	authMock.mockResolvedValue({ user: { id: 7, name: "bob" } });
	clientIpMock.mockResolvedValue("1.2.3.4");
	rateLimitMock.mockResolvedValue({ ok: true, retryAfter: 0 });
});

const redirects = async (run: () => Promise<void>) => {
	await expect(run()).rejects.toThrow("NEXT_REDIRECT");
};

describe("acceptFriend", () => {
	it("redirects unauthenticated users to login", async () => {
		authMock.mockResolvedValue(null);
		await redirects(() => acceptFriend(fakeForm({ requestId: "5" })));
		expect(redirectMock).toHaveBeenCalledWith("/login");
	});

	it("reports a rate limit", async () => {
		rateLimitMock.mockResolvedValue({ ok: false, retryAfter: 3 });
		await redirects(() => acceptFriend(fakeForm({ requestId: "5" })));
		expect(redirected()).toBe("/messages?error=ratelimit");
	});

	it("rejects an invalid request id", async () => {
		await redirects(() => acceptFriend(fakeForm({ requestId: "abc" })));
		expect(redirected()).toBe("/messages?error=invalid");
	});

	it("reports a missing request", async () => {
		state.requests = [];
		await redirects(() => acceptFriend(fakeForm({ requestId: "5" })));
		expect(redirected()).toBe("/messages?error=not_found");
	});

	it("refuses a request addressed to someone else", async () => {
		state.requests = [{ id: 5, userFromId: 2, userToId: 99 }];
		await redirects(() => acceptFriend(fakeForm({ requestId: "5" })));
		expect(redirected()).toBe("/messages?error=unauthorized");
	});

	it("clears a malformed self-addressed request", async () => {
		state.requests = [{ id: 5, userFromId: 7, userToId: 7 }];
		await redirects(() => acceptFriend(fakeForm({ requestId: "5" })));
		expect(state.deletes).toContainEqual(expect.anything());
		expect(redirected()).toBe("/messages?error=not_found");
	});

	it("clears a malformed non-positive sender request", async () => {
		state.requests = [{ id: 5, userFromId: 0, userToId: 7 }];
		await redirects(() => acceptFriend(fakeForm({ requestId: "5" })));
		expect(redirected()).toBe("/messages?error=not_found");
	});

	it("accepts a valid request and creates both friendship rows", async () => {
		state.requests = [{ id: 5, userFromId: 2, userToId: 7 }];
		await redirects(() => acceptFriend(fakeForm({ requestId: "5" })));
		expect(state.inserts).toHaveLength(1);
		expect(state.inserts[0].value).toEqual([
			{ userOneId: 7, userTwoId: 2, friendsSince: expect.any(Number) },
			{ userOneId: 2, userTwoId: 7, friendsSince: expect.any(Number) },
		]);
		expect(revalidatePathMock).toHaveBeenCalledWith("/messages");
		expect(revalidatePathMock).toHaveBeenCalledWith("/friends");
		expect(redirected()).toBe("/messages?accepted=1");
	});

	it("accepts without inserting when a friendship already exists", async () => {
		state.requests = [{ id: 5, userFromId: 2, userToId: 7 }];
		state.friendships = [{ id: 1 }];
		await redirects(() => acceptFriend(fakeForm({ requestId: "5" })));
		expect(state.inserts).toHaveLength(0);
		expect(redirected()).toBe("/messages?accepted=1");
	});

	it("maps an unexpected failure to ?error=error", async () => {
		authMock.mockRejectedValue(new Error("db down"));
		await redirects(() => acceptFriend(fakeForm({ requestId: "5" })));
		expect(redirected()).toBe("/messages?error=error");
	});
});

describe("declineFriendRequest", () => {
	it("redirects unauthenticated users to login", async () => {
		authMock.mockResolvedValue(null);
		await redirects(() => declineFriendRequest(fakeForm({ requestId: "5" })));
		expect(redirectMock).toHaveBeenCalledWith("/login");
	});

	it("reports a rate limit", async () => {
		rateLimitMock.mockResolvedValue({ ok: false, retryAfter: 3 });
		await redirects(() => declineFriendRequest(fakeForm({ requestId: "5" })));
		expect(redirected()).toBe("/messages?error=ratelimit");
	});

	it("rejects an invalid request id", async () => {
		await redirects(() => declineFriendRequest(fakeForm({ requestId: "0" })));
		expect(redirected()).toBe("/messages?error=invalid");
	});

	it("reports a missing request", async () => {
		state.requests = [];
		await redirects(() => declineFriendRequest(fakeForm({ requestId: "5" })));
		expect(redirected()).toBe("/messages?error=not_found");
	});

	it("refuses a request addressed to someone else", async () => {
		state.requests = [{ id: 5, userToId: 99 }];
		await redirects(() => declineFriendRequest(fakeForm({ requestId: "5" })));
		expect(redirected()).toBe("/messages?error=unauthorized");
	});

	it("declines a valid request", async () => {
		state.requests = [{ id: 5, userToId: 7 }];
		await redirects(() => declineFriendRequest(fakeForm({ requestId: "5" })));
		expect(state.deletes).toContainEqual(expect.anything());
		expect(redirected()).toBe("/messages?declined=1");
	});

	it("maps an unexpected failure to ?error=error", async () => {
		authMock.mockRejectedValue(new Error("db down"));
		await redirects(() => declineFriendRequest(fakeForm({ requestId: "5" })));
		expect(redirected()).toBe("/messages?error=error");
	});
});

describe("removeFriendship", () => {
	it("redirects unauthenticated users to login", async () => {
		authMock.mockResolvedValue(null);
		await redirects(() => removeFriendship(fakeForm({ friendId: "2" })));
		expect(redirectMock).toHaveBeenCalledWith("/login");
	});

	it("reports a rate limit", async () => {
		rateLimitMock.mockResolvedValue({ ok: false, retryAfter: 3 });
		await redirects(() => removeFriendship(fakeForm({ friendId: "2" })));
		expect(redirected()).toBe("/friends?error=ratelimit");
	});

	it("rejects invalid or self friend ids", async () => {
		await redirects(() => removeFriendship(fakeForm({ friendId: "0" })));
		expect(redirected()).toBe("/friends?error=invalid");
		await redirects(() => removeFriendship(fakeForm({ friendId: "7" })));
		expect(redirected()).toBe("/friends?error=invalid");
	});

	it("removes an existing friendship", async () => {
		state.affectedDelete = 1;
		await redirects(() => removeFriendship(fakeForm({ friendId: "2" })));
		expect(state.deletes).toHaveLength(2);
		expect(redirected()).toBe("/friends?removed=1");
	});

	it("reports a friendship that did not exist", async () => {
		state.affectedDelete = 0;
		await redirects(() => removeFriendship(fakeForm({ friendId: "2" })));
		expect(redirected()).toBe("/friends?error=not_found");
	});

	it("handles a driver result with no rows", async () => {
		state.emptyDeleteResult = true;
		await redirects(() => removeFriendship(fakeForm({ friendId: "2" })));
		expect(redirected()).toBe("/friends?error=not_found");
	});

	it("maps an unexpected failure to ?error=error", async () => {
		authMock.mockRejectedValue(new Error("db down"));
		await redirects(() => removeFriendship(fakeForm({ friendId: "2" })));
		expect(redirected()).toBe("/friends?error=error");
	});
});

describe("sendOfflineMessage", () => {
	it("redirects unauthenticated users to login", async () => {
		authMock.mockResolvedValue(null);
		await redirects(() =>
			sendOfflineMessage(fakeForm({ friendId: "2", message: "hi" })),
		);
		expect(redirectMock).toHaveBeenCalledWith("/login");
	});

	it("reports a rate limit", async () => {
		rateLimitMock.mockResolvedValue({ ok: false, retryAfter: 3 });
		await redirects(() =>
			sendOfflineMessage(fakeForm({ friendId: "2", message: "hi" })),
		);
		expect(redirected()).toBe("/messages?send_error=rate_limited");
	});

	it("rejects an invalid friend id", async () => {
		await redirects(() =>
			sendOfflineMessage(fakeForm({ friendId: "0", message: "hi" })),
		);
		expect(redirected()).toBe("/messages?send_error=invalid");
	});

	it("rejects an empty message", async () => {
		await redirects(() =>
			sendOfflineMessage(fakeForm({ friendId: "2", message: "   " })),
		);
		expect(redirected()).toBe("/messages?send_error=empty");
	});

	it("rejects a missing message field", async () => {
		await redirects(() => sendOfflineMessage(fakeForm({ friendId: "2" })));
		expect(redirected()).toBe("/messages?send_error=empty");
	});

	it("refuses to message a non-friend", async () => {
		state.friendships = [];
		await redirects(() =>
			sendOfflineMessage(fakeForm({ friendId: "2", message: "hi" })),
		);
		expect(redirected()).toBe("/messages?send_error=not_friend");
	});

	it("rejects a friend that no longer exists", async () => {
		state.friendships = [{ id: 1 }];
		state.users = [];
		await redirects(() =>
			sendOfflineMessage(fakeForm({ friendId: "2", message: "hi" })),
		);
		expect(redirected()).toBe("/messages?send_error=invalid");
	});

	it("rejects content blocked by the word filter before storing it", async () => {
		state.friendships = [{ id: 1 }];
		state.isAllowed.mockResolvedValue({ ok: false, reason: "bad" });
		await redirects(() =>
			sendOfflineMessage(fakeForm({ friendId: "2", message: "rude words" })),
		);
		expect(state.isAllowed).toHaveBeenCalledWith("rude words");
		expect(state.inserts).toHaveLength(0);
		expect(redirected()).toBe("/messages?send_error=invalid");
		state.isAllowed.mockResolvedValue({ ok: true });
	});

	it("stores an offline message for a friend", async () => {
		state.friendships = [{ id: 1 }];
		await redirects(() =>
			sendOfflineMessage(
				fakeForm({ friendId: "2", message: "  hello there  " }),
			),
		);
		expect(state.inserts.at(-1)?.value).toMatchObject({
			userId: 2,
			userFromId: 7,
			message: "hello there",
			sendedOn: expect.any(Number),
		});
		expect(revalidatePathMock).toHaveBeenCalledWith("/messages");
		expect(redirected()).toBe("/messages?sent=1");
	});

	it("maps an unexpected failure to ?error=error", async () => {
		authMock.mockRejectedValue(new Error("db down"));
		await redirects(() =>
			sendOfflineMessage(fakeForm({ friendId: "2", message: "hi" })),
		);
		expect(redirected()).toBe("/messages?send_error=error");
	});
});
