// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeForm } from "@/test/fake-form";

const state = vi.hoisted(() => ({ inserted: [] as any[] }));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb(() => []);
	return {
		...schema,
		db: {
			...fake,
			insert: () => ({
				values: (v: any) => {
					state.inserted.push(v);
					return Promise.resolve([{ insertId: 1 }]);
				},
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

const isAllowedMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/moderation", () => ({ isAllowed: isAllowedMock }));

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

import { postGuestbook } from "./guestbook";

beforeEach(() => {
	vi.clearAllMocks();
	state.inserted = [];
	authMock.mockResolvedValue({ user: { id: 5, name: "bob" } });
	clientIpMock.mockResolvedValue("1.2.3.4");
	rateLimitMock.mockResolvedValue({ ok: true, retryAfter: 0 });
	isAllowedMock.mockResolvedValue({ ok: true });
});

describe("postGuestbook", () => {
	it("redirects unauthenticated users to login", async () => {
		authMock.mockResolvedValue(null);
		await expect(
			postGuestbook(fakeForm({ username: "bob", profileId: "9" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirectMock).toHaveBeenCalledWith("/login");
		expect(state.inserted).toEqual([]);
	});

	it("redirects when the session id is not a positive integer", async () => {
		authMock.mockResolvedValue({ user: { id: 0, name: "bob" } });
		await expect(
			postGuestbook(fakeForm({ username: "bob", profileId: "9" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirectMock).toHaveBeenCalledWith("/login");
	});

	it("reports a rate limit without touching the database", async () => {
		rateLimitMock.mockResolvedValue({ ok: false, retryAfter: 12 });
		await expect(
			postGuestbook(fakeForm({ username: "bob", profileId: "9" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirectMock).toHaveBeenCalledWith("/u/bob?error=ratelimit");
		expect(rateLimitMock).toHaveBeenCalledWith("guestbook:5", 5, 30_000);
		expect(clientIpMock).toHaveBeenCalled();
		expect(state.inserted).toEqual([]);
	});

	it.each(["", "abc", "0", "-1", "3.5"])(
		"rejects an invalid profile id (%s)",
		async (profileId) => {
			await expect(
				postGuestbook(fakeForm({ username: "bob", profileId })),
			).rejects.toThrow("NEXT_REDIRECT");
			expect(redirectMock).toHaveBeenCalledWith("/u/bob?error=invalid");
			expect(state.inserted).toEqual([]);
		},
	);

	it("rejects an empty message", async () => {
		await expect(
			postGuestbook(
				fakeForm({ username: "bob", profileId: "9", message: "   " }),
			),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirectMock).toHaveBeenCalledWith("/u/bob?error=empty");
		expect(state.inserted).toEqual([]);
	});

	it("treats a missing message field as empty", async () => {
		await expect(
			postGuestbook(fakeForm({ username: "bob", profileId: "9" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirectMock).toHaveBeenCalledWith("/u/bob?error=empty");
		expect(state.inserted).toEqual([]);
	});

	it("blocks a moderated message", async () => {
		isAllowedMock.mockResolvedValue({ ok: false, reason: "bad" });
		await expect(
			postGuestbook(
				fakeForm({ username: "bob", profileId: "9", message: "bad word" }),
			),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirectMock).toHaveBeenCalledWith("/u/bob?error=moderated");
		expect(state.inserted).toEqual([]);
	});

	it("inserts a trimmed, 255-char-capped entry and revalidates the profile", async () => {
		const long = `  ${"x".repeat(300)}  `;
		await expect(
			postGuestbook(
				fakeForm({ username: "  bob  ", profileId: "42", message: long }),
			),
		).rejects.toThrow("NEXT_REDIRECT");

		expect(state.inserted).toHaveLength(1);
		expect(state.inserted[0]).toMatchObject({
			profileId: 42,
			userId: 5,
			message: "x".repeat(255),
		});
		expect(state.inserted[0].message).toHaveLength(255);
		expect(state.inserted[0].createdAt).toBeInstanceOf(Date);
		expect(state.inserted[0].updatedAt).toBeInstanceOf(Date);
		expect(revalidatePathMock).toHaveBeenCalledWith("/u/bob");
		expect(redirectMock).toHaveBeenCalledWith("/u/bob?guestbook=posted");
	});

	it("falls back to the root path when no username is supplied", async () => {
		await expect(postGuestbook(fakeForm({ profileId: "0" }))).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(redirectMock).toHaveBeenCalledWith("/?error=invalid");
		expect(revalidatePathMock).not.toHaveBeenCalled();
	});

	it("swallows unexpected database errors and reports ?error=error", async () => {
		const { db } = await import("@/lib/db");
		vi.spyOn(db, "insert").mockReturnValueOnce({
			values: () => Promise.reject(new Error("db down")),
		} as never);
		await expect(
			postGuestbook(
				fakeForm({ username: "bob", profileId: "9", message: "hello" }),
			),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirectMock).toHaveBeenCalledWith("/u/bob?error=error");
	});
});
