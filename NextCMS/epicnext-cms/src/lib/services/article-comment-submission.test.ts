// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	userId: 100,
	sessionId: "100" as string | null,
	article: {
		id: "12",
		slug: "public-news",
		status: "published",
		publishAt: null as Date | null,
	},
	words: [] as string[],
	queries: [] as string[],
	writes: [] as unknown[][],
	transactions: 0,
	lockedWrites: [] as boolean[],
	inTransaction: false,
	failRead: false,
	failWrite: false,
	withdrawDuringModeration: false,
	log: vi.fn(),
	revalidate: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { drizzle } = await import("drizzle-orm/mysql-proxy");
	const db = drizzle(async (query, parameters) => {
		state.queries.push(query);
		if (query.includes(" from `website_wordfilter`")) {
			if (state.withdrawDuringModeration) state.article.status = "draft";
			return { rows: state.words.map((word) => [word]) };
		}
		if (
			query.startsWith("select ") &&
			query.includes(" from `website_articles`")
		) {
			if (state.failRead) throw new Error("private SQL and comment payload");
			if (
				query.includes("`status` = ?") &&
				state.article.status !== "published"
			)
				return { rows: [] };
			if (
				query.includes("<= NOW()") &&
				state.article.publishAt &&
				state.article.publishAt > new Date()
			)
				return { rows: [] };
			if (
				String(parameters[0]) !== state.article.id &&
				parameters[0] !== state.article.slug
			)
				return { rows: [] };
			const columns = query
				.slice(7, query.indexOf(" from "))
				.split(", ")
				.map((column) => column.replaceAll("`", ""));
			return {
				rows: [columns.map((column) => state.article[column as "id" | "slug"])],
			};
		}
		if (query.startsWith("insert into `website_article_comments`")) {
			if (state.failWrite) throw new Error("private SQL and comment payload");
			state.writes.push(parameters);
			state.lockedWrites.push(
				state.inTransaction &&
					state.queries.some((sql) => sql.endsWith("for update")),
			);
			return { rows: [{ insertId: 1, affectedRows: 1 }] };
		}
		return { rows: [] };
	});
	Object.defineProperty(db, "transaction", {
		value: async (callback: (tx: typeof db) => Promise<unknown>) => {
			state.transactions += 1;
			state.inTransaction = true;
			try {
				return await callback(db);
			} finally {
				state.inTransaction = false;
			}
		},
	});
	return { ...schema, db };
});
vi.mock("@/lib/auth", () => ({
	auth: async () => ({ user: { id: state.sessionId } }),
}));
vi.mock("@/lib/api-auth", () => ({
	bearerUserId: async () => state.userId || null,
}));
vi.mock("@/env", () => ({ env: {} }));
vi.mock("@/lib/redis", () => ({ redis: null }));
vi.mock("@/lib/logger", () => ({ logger: { error: state.log } }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({
	redirect: (url: string) => {
		throw Object.assign(new Error(url), {
			digest: `NEXT_REDIRECT;replace;${url};307;`,
		});
	},
}));

import { postComment } from "@/actions/article-comments";
import { POST } from "@/app/api/articles/[slug]/comment/route";
import { reloadWordFilter } from "@/lib/services/moderation";

function api(comment: unknown = "Hello", slug = "public-news") {
	return POST(
		new Request("https://hotel.test/api/articles/public-news/comment", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ comment, userId: 999 }),
		}),
		{ params: Promise.resolve({ slug }) },
	);
}
async function site(comment = "Hello", articleId = "12") {
	const form = new FormData();
	form.set("comment", comment);
	form.set("articleId", articleId);
	form.set("slug", "public-news");
	form.set("userId", "999");
	try {
		await postComment(form);
	} catch (error) {
		if (error instanceof Error && "digest" in error) return error.message;
		throw error;
	}
	throw new Error("Expected action redirect");
}

beforeEach(() => {
	state.userId += 1;
	state.sessionId = String(state.userId);
	state.article = {
		id: "12",
		slug: "public-news",
		status: "published",
		publishAt: null,
	};
	state.words = [];
	state.queries = [];
	state.writes = [];
	state.lockedWrites = [];
	state.transactions = 0;
	state.inTransaction = false;
	state.failRead = false;
	state.failWrite = false;
	state.withdrawDuringModeration = false;
	state.log.mockReset();
	state.revalidate.mockReset();
	reloadWordFilter();
});

describe("article comment entrypoints share publication and abuse policy", () => {
	it.each(["draft", "scheduled"])(
		"blocks %s articles through both channels",
		async (status) => {
			state.article.status = status;
			expect(await site()).toBe("/news/public-news?error=not_found");
			expect((await api()).status).toBe(404);
			expect(state.writes).toHaveLength(0);
		},
	);
	it("blocks published articles whose scheduled date is still in the future", async () => {
		state.article.publishAt = new Date(Date.now() + 60_000);
		expect(await site()).toBe("/news/public-news?error=not_found");
		expect((await api()).status).toBe(404);
		expect(state.writes).toHaveLength(0);
	});
	it("keeps due articles writable and locks eligibility until each insert", async () => {
		state.article.publishAt = new Date(Date.now() - 60_000);
		expect(await site()).toBe("/news/public-news?comment=posted");
		const response = await api();
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(state.transactions).toBe(2);
		expect(state.lockedWrites).toEqual([true, true]);
		expect(state.writes).toHaveLength(2);
		for (const parameters of state.writes) {
			expect(parameters).toContain(state.userId);
			expect(parameters).not.toContain(999);
		}
	});
	it("applies the real configured word filter to both channels", async () => {
		state.words = ["forbidden"];
		expect(await site("FORBIDDEN content")).toBe(
			"/news/public-news?error=moderated",
		);
		expect((await api("FORBIDDEN content")).status).toBe(422);
		expect(state.writes).toHaveLength(0);
	});
	it("rechecks publication after moderation completes", async () => {
		state.withdrawDuringModeration = true;
		expect((await api()).status).toBe(404);
		expect(state.writes).toHaveLength(0);
	});
	it.each(["site", "api"])(
		"shares five attempts across channels starting with %s",
		async (first) => {
			for (let i = 0; i < 5; i++) {
				if (first === "site") expect(await site()).toContain("comment=posted");
				else expect((await api()).status).toBe(200);
			}
			if (first === "site") expect((await api()).status).toBe(429);
			else expect(await site()).toBe("/news/public-news?error=ratelimit");
			expect(state.writes).toHaveLength(5);
		},
	);
	it("normalizes the same text before moderation and persistence", async () => {
		await site("  cafe\u0301  ");
		await api("  cafe\u0301  ");
		expect(state.writes).toHaveLength(2);
		for (const parameters of state.writes) expect(parameters).toContain("café");
	});
	it.each(["failRead", "failWrite"] as const)(
		"returns safe recoverable errors for %s",
		async (failure) => {
			state[failure] = true;
			expect(await site()).toBe("/news/public-news?error=error");
			const response = await api();
			expect(response.status).toBe(503);
			expect(await response.json()).toEqual({
				error: "Could not post comment",
			});
			expect(state.log).toHaveBeenCalledTimes(2);
			expect(JSON.stringify(state.log.mock.calls)).not.toContain("private SQL");
			expect(state.writes).toHaveLength(0);
		},
	);
	it("rejects missing articles without inserting", async () => {
		expect(await site("Hello", "42")).toContain("error=not_found");
		expect((await api("Hello", "missing")).status).toBe(404);
		expect(state.writes).toHaveLength(0);
	});
	it("keeps sessions mandatory for forms and bearer authentication for API", async () => {
		state.userId = 0;
		state.sessionId = null;
		expect(await site()).toBe("/login");
		expect((await api()).status).toBe(401);
		expect(state.writes).toHaveLength(0);
	});
	it("rejects oversized input before insertion without silently truncating", async () => {
		expect(await site("a".repeat(256))).toContain("error=invalid");
		expect((await api("a".repeat(256))).status).toBe(422);
		expect(state.writes).toHaveLength(0);
	});
	it("does not turn a committed comment into a retry when revalidation fails", async () => {
		state.revalidate.mockImplementation(() => {
			throw new Error("cache unavailable");
		});
		expect(await site()).toContain("comment=posted");
		expect(state.writes).toHaveLength(1);
	});
});
