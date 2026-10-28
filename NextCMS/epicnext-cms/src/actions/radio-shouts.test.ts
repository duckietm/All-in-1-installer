// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	auth: vi.fn(async () => ({ user: { id: "5" } })),
	rateLimit: vi.fn(async () => ({ ok: true })),
	clientIp: vi.fn(async () => "203.0.113.9"),
	revalidatePath: vi.fn(),
	insert: vi.fn(async () => [{ insertId: 1 }]),
	moderateOrThrow: vi.fn(async () => undefined),
	failInsert: false,
	rejectContent: false,
}));

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
vi.mock("@/lib/services/moderation", () => ({
	moderateOrThrow: state.moderateOrThrow,
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb(() => []);
	return {
		...schema,
		db: {
			...fake,
			insert: (table: unknown) => ({
				values: (values: unknown) =>
					state.failInsert
						? Promise.reject(new Error("db down"))
						: state.insert(table, values),
			}),
		},
	};
});

import { RadioShouts } from "@/lib/db";
import { postShout } from "./radio-shouts";

function buildForm(overrides: Record<string, string | undefined> = {}) {
	const f = new FormData();
	f.set("message", "Hello everyone!");
	for (const [k, v] of Object.entries(overrides)) {
		if (v === undefined) f.delete(k);
		else f.set(k, v);
	}
	return f;
}

describe("postShout", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.failInsert = false;
		state.rejectContent = false;
		state.auth.mockResolvedValue({ user: { id: "5" } });
		state.rateLimit.mockResolvedValue({ ok: true });
		state.insert.mockResolvedValue([{ insertId: 1 }]);
		state.moderateOrThrow.mockResolvedValue(undefined);
	});

	it("posts a shouted message and redirects to ?posted=1", async () => {
		await expect(postShout(buildForm())).rejects.toThrow(
			"/radio/shouts?posted=1",
		);
		expect(state.rateLimit).toHaveBeenCalledWith("shout:5", 5, 30_000);
		expect(state.moderateOrThrow).toHaveBeenCalledWith("Hello everyone!");
		expect(state.insert).toHaveBeenCalledOnce();
		expect(state.insert.mock.calls[0][0]).toBe(RadioShouts);
		expect(state.insert.mock.calls[0][1]).toMatchObject({
			userId: 5n,
			message: "Hello everyone!",
			createdAt: expect.any(Date),
			updatedAt: expect.any(Date),
		});
		expect(state.revalidatePath).toHaveBeenCalledWith("/radio/shouts");
	});

	it("truncates the message before validating and storing", async () => {
		await expect(
			postShout(buildForm({ message: "M".repeat(300) })),
		).rejects.toThrow("/radio/shouts?posted=1");
		const values = state.insert.mock.calls[0][1] as { message: string };
		expect(values.message).toHaveLength(255);
	});

	it("rejects an empty or whitespace-only message as invalid", async () => {
		await expect(postShout(buildForm({ message: "" }))).rejects.toThrow(
			"/radio/shouts?error=invalid",
		);
		await expect(postShout(buildForm({ message: "   " }))).rejects.toThrow(
			"/radio/shouts?error=invalid",
		);
		await expect(postShout(buildForm({ message: undefined }))).rejects.toThrow(
			"/radio/shouts?error=invalid",
		);
		expect(state.insert).not.toHaveBeenCalled();
		expect(state.revalidatePath).toHaveBeenCalledWith("/radio/shouts");
	});

	it("redirects with error=moderated when content moderation rejects the message", async () => {
		state.moderateOrThrow.mockRejectedValue(
			new Error("Blocked by word filter"),
		);
		await expect(postShout(buildForm())).rejects.toThrow(
			"/radio/shouts?error=moderated",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("redirects with error=ratelimit when throttled", async () => {
		state.rateLimit.mockResolvedValue({ ok: false, retryAfter: 8 });
		await expect(postShout(buildForm())).rejects.toThrow(
			"/radio/shouts?error=ratelimit",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("redirects to /login when unauthenticated", async () => {
		state.auth.mockResolvedValue({ user: { id: undefined } });
		await expect(postShout(buildForm())).rejects.toThrow("/login");
		state.auth.mockResolvedValue({ user: { id: "0" } });
		await expect(postShout(buildForm())).rejects.toThrow("/login");
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("swallows internal failures and redirects with error=error", async () => {
		state.failInsert = true;
		await expect(postShout(buildForm())).rejects.toThrow(
			"/radio/shouts?error=error",
		);
		state.failInsert = false;
		state.auth.mockRejectedValueOnce(new Error("auth down"));
		await expect(postShout(buildForm())).rejects.toThrow(
			"/radio/shouts?error=error",
		);
	});
});
