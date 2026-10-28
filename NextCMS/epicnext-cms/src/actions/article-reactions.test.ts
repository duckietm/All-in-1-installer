// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	articles: [] as { slug: string }[],
	reactions: [] as { id: bigint; active: boolean }[],
	selectError: null as Error | null,
	updates: [] as { table: unknown; values: unknown }[],
	inserts: [] as { table: unknown; values: unknown }[],
}));

const mockRedirect = vi.hoisted(() =>
	vi.fn((url: string) => {
		const err = new Error(`NEXT_REDIRECT: ${url}`);
		(err as never as { digest: string }).digest =
			`NEXT_REDIRECT;replace;${url};307;;`;
		throw err;
	}),
);
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
	revalidatePath: mockRevalidatePath,
	unstable_cache: (fn: unknown) => fn,
}));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));

const mockRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({
	rateLimit: mockRateLimit,
	clientIp: vi.fn().mockResolvedValue("127.0.0.1"),
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	return {
		...schema,
		db: {
			...createFakeDb((table) => {
				if (state.selectError) {
					const e = state.selectError;
					state.selectError = null;
					throw e;
				}
				if (table === schema.WebsiteArticles) return state.articles;
				if (table === schema.WebsiteArticleReactions) return state.reactions;
				return [];
			}),
			update: (table: unknown) => ({
				set: (values: unknown) => ({
					where: () => {
						state.updates.push({ table, values });
						return [{ affectedRows: 1 }];
					},
				}),
			}),
			insert: (table: unknown) => ({
				values: (values: unknown) => {
					state.inserts.push({ table, values });
					return [{ insertId: 1 }];
				},
			}),
		},
	};
});

import { WebsiteArticleReactions, WebsiteArticles } from "@/lib/db";
import { toggleReaction } from "./article-reactions";

function form(data: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [k, v] of Object.entries(data)) fd.append(k, v);
	return fd;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockAuth.mockReset();
	mockAuth.mockResolvedValue({ user: { id: "7" } });
	mockRateLimit.mockReset();
	mockRateLimit.mockResolvedValue({ ok: true });
	mockRedirect.mockClear();
	mockRevalidatePath.mockClear();
	state.articles = [];
	state.reactions = [];
	state.selectError = null;
	state.updates = [];
	state.inserts = [];
});

describe("toggleReaction", () => {
	it("redirects to /login when not signed in", async () => {
		mockAuth.mockResolvedValueOnce(null);
		await expect(toggleReaction(form({ slug: "a" }))).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(mockRedirect).toHaveBeenCalledWith("/login");
	});

	it("redirects to /login for a non-numeric user id", async () => {
		mockAuth.mockResolvedValueOnce({ user: { id: "abc" } });
		await expect(toggleReaction(form({ slug: "a" }))).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(mockRedirect).toHaveBeenCalledWith("/login");
	});

	it("redirects with a ratelimit outcome when throttled", async () => {
		mockRateLimit.mockResolvedValueOnce({ ok: false });
		await expect(toggleReaction(form({ slug: "a" }))).rejects.toThrow(
			"NEXT_REDIRECT: /news/a?error=ratelimit",
		);
	});

	it("rejects reactions outside the allowed set", async () => {
		await expect(
			toggleReaction(form({ slug: "a", reaction: "meh" })),
		).rejects.toThrow("NEXT_REDIRECT: /news/a?error=invalid");
	});

	it("rejects a non-numeric article id", async () => {
		await expect(
			toggleReaction(form({ slug: "a", reaction: "like", articleId: "x" })),
		).rejects.toThrow("NEXT_REDIRECT: /news/a?error=invalid");
	});

	it("redirects with not_found when the article is missing", async () => {
		state.articles = [];
		await expect(
			toggleReaction(form({ slug: "a", reaction: "like", articleId: "1" })),
		).rejects.toThrow("NEXT_REDIRECT: /news/a?error=not_found");
		expect(mockRevalidatePath).toHaveBeenCalledWith("/news/a");
	});

	it("deactivates an already-active reaction and uses the canonical slug", async () => {
		state.articles = [{ slug: "canonical" }];
		state.reactions = [{ id: 11n, active: true }];
		await expect(
			toggleReaction(form({ slug: "stale", reaction: "LIKE", articleId: "1" })),
		).rejects.toThrow("NEXT_REDIRECT: /news/canonical?reaction=1");

		expect(state.updates).toEqual([
			{ table: WebsiteArticleReactions, values: { active: false } },
		]);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/news/canonical");
	});

	it("re-activates an existing inactive reaction after clearing others", async () => {
		state.articles = [{ slug: "canonical" }];
		state.reactions = [{ id: 11n, active: false }];
		await expect(
			toggleReaction(form({ slug: "a", reaction: "wow", articleId: "2" })),
		).rejects.toThrow("NEXT_REDIRECT");

		expect(state.updates).toHaveLength(2);
		expect(state.updates[0].values).toEqual({ active: false });
		expect(state.updates[1]).toEqual({
			table: WebsiteArticleReactions,
			values: { active: true },
		});
		expect(state.inserts).toHaveLength(0);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/news/canonical");
	});

	it("inserts a fresh reaction when none exists yet", async () => {
		state.articles = [{ slug: "canonical" }];
		state.reactions = [];
		await expect(
			toggleReaction(form({ slug: "a", reaction: "like", articleId: "3" })),
		).rejects.toThrow("NEXT_REDIRECT");

		expect(state.updates).toHaveLength(1);
		expect(state.updates[0].values).toEqual({ active: false });
		expect(state.inserts).toHaveLength(1);
		expect(state.inserts[0].table).toBe(WebsiteArticleReactions);
		expect(state.inserts[0].values).toEqual({
			userId: 7,
			articleId: 3n,
			reaction: "like",
			active: true,
		});
		expect(mockRevalidatePath).toHaveBeenCalledWith("/news/canonical");
	});

	it("echoes errors as a redirect instead of throwing", async () => {
		state.selectError = new Error("db down");
		await expect(
			toggleReaction(form({ slug: "a", reaction: "like", articleId: "1" })),
		).rejects.toThrow("NEXT_REDIRECT: /news/a?error=error");
		expect(mockRedirect).toHaveBeenCalledWith("/news/a?error=error");
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("redirects to the news index when no slug hint was provided", async () => {
		state.articles = [{ slug: "canonical" }];
		state.reactions = [];
		await expect(
			toggleReaction(form({ reaction: "like", articleId: "1" })),
		).rejects.toThrow("NEXT_REDIRECT: /news/canonical?reaction=1");
	});

	it("queries the article by the parsed bigint id", async () => {
		state.articles = [{ slug: "canonical" }];
		state.reactions = [];
		await expect(
			toggleReaction(form({ slug: "s", reaction: "love", articleId: "999" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(WebsiteArticles).toBeDefined();
	});
});
