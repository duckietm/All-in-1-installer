// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	fail: false,
	articleRows: [] as unknown[][],
	commentRows: [] as unknown[][],
	reactionRows: [] as unknown[][],
	total: 225,
	queries: [] as { sql: string; params: unknown[] }[],
	values: new Map<string, string>(),
}));
vi.mock("@/lib/services/news-cache", () => ({
	cacheNews: async (
		key: string,
		_ttl: number,
		query: () => Promise<unknown>,
	) => {
		const existing = state.values.get(key);
		if (existing !== undefined) return JSON.parse(existing);
		const result = await query();
		const serialized = JSON.stringify(result);
		state.values.set(key, serialized);
		return JSON.parse(serialized);
	},
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { drizzle } = await import("drizzle-orm/mysql-proxy");
	return {
		...schema,
		db: drizzle(async (sql, params) => {
			state.queries.push({ sql, params });
			if (state.fail) throw new Error("database unavailable");
			if (sql.includes("count(*)") && !sql.includes("group by"))
				return { rows: [[state.total]] };
			if (sql.includes("website_article_comments"))
				return { rows: state.commentRows };
			if (sql.includes("website_article_reactions"))
				return { rows: state.reactionRows };
			return { rows: state.articleRows };
		}),
	};
});

import {
	getArticleComments,
	getArticleReactions,
	getPublishedArticle,
} from "./news-detail";

beforeEach(() => {
	state.fail = false;
	state.values.clear();
	state.queries = [];
	state.articleRows = [];
	state.commentRows = [];
	state.reactionRows = [];
	state.total = 225;
});

describe("public article loading", () => {
	it("keeps database failures retryable instead of caching a missing article", async () => {
		state.fail = true;
		await expect(getPublishedArticle("community-update")).rejects.toThrow();
		state.fail = false;
		expect(await getPublishedArticle("community-update")).toBeNull();
		expect(state.queries).toHaveLength(2);
	});

	it("round-trips large IDs and publication dates through a JSON cache", async () => {
		state.articleRows = [
			[
				"9007199254740993",
				"community-update",
				"Title",
				"Summary",
				"<p>Body</p>",
				"",
				"2030-01-01 10:00:00",
				"2030-02-01 10:00:00",
				"2030-02-01 10:00:00",
				"2030-02-01 10:01:00",
			],
		];
		const article = await getPublishedArticle("community-update");
		expect(article?.id).toBe(9007199254740993n);
		expect(article?.publishAt).toEqual(new Date("2030-02-01T10:00:00Z"));
		expect(article?.createdAt).toEqual(new Date("2030-01-01T10:00:00Z"));
		expect(await getPublishedArticle("community-update")).toEqual(article);
		expect(state.queries).toHaveLength(1);
	});

	it("only selects articles that are published and already due", async () => {
		expect(await getPublishedArticle("quote'")).toBeNull();
		expect(state.queries[0].sql).toContain("`status` = ?");
		expect(state.queries[0].sql).toContain("<= NOW()");
		expect(state.queries[0].params).toEqual(["quote'", "published", 1]);
	});
});

describe("public article comments", () => {
	it("makes comments beyond the former 200 item ceiling reachable", async () => {
		state.commentRows = [
			["225", 7, "Comment beyond 200", "2030-01-01 12:00:00", "Member"],
		];
		const result = await getArticleComments(12n, 9);
		expect(result).toMatchObject({
			total: 225,
			page: 9,
			perPage: 25,
			lastPage: 9,
			rows: [{ id: 225n, comment: "Comment beyond 200", username: "Member" }],
		});
		expect(state.queries[1].params.slice(-2)).toEqual([25, 200]);
		expect(state.queries[1].sql).toMatch(
			/order by .*`created_at` asc, .*`id` asc/,
		);
		expect(state.queries.every((query) => query.params[0] === 12n)).toBe(true);
	});

	it.each([
		[-5, 1, 0],
		[NaN, 1, 0],
		[Infinity, 1, 0],
		[1e99, 9, 200],
		["last", 9, 200],
	])("bounds requested page %s", async (requested, page, offset) => {
		expect(
			await getArticleComments(12n, requested as number | "last"),
		).toMatchObject({ page });
		expect(state.queries[1].params).toEqual(
			offset === 0 ? [12n, 25] : [12n, 25, offset],
		);
	});

	it("preserves a successful empty page", async () => {
		state.total = 0;
		expect(await getArticleComments(12n, "last")).toMatchObject({
			rows: [],
			total: 0,
			page: 1,
			lastPage: 1,
		});
	});

	it("propagates a failed comment read instead of claiming there are no comments", async () => {
		state.fail = true;
		await expect(getArticleComments(12n)).rejects.toThrow();
	});
});

describe("public article reactions", () => {
	it("aggregates counts and the current user's reaction without loading every vote", async () => {
		state.reactionRows = [
			["love", 1200, 1],
			["like", 30, 0],
		];
		const result = await getArticleReactions(12n, 7);
		expect(result.counts.get("love")).toBe(1200);
		expect(result.myReaction).toBe("love");
		expect(state.queries[0].sql).toContain("group by");
		expect(state.queries[0].params).toContain(7);
	});

	it("does not hide a failed reaction read behind zero counts", async () => {
		state.fail = true;
		await expect(getArticleReactions(12n, null)).rejects.toThrow();
	});
});

it("ignores legacy cached absence and loads the current public article", async () => {
	state.values.set("article:slug:community-update", "null");
	state.articleRows = [
		[
			"12",
			"community-update",
			"Current article",
			"Summary",
			"<p>Current body</p>",
			"",
			null,
			null,
			null,
			null,
		],
	];
	expect(await getPublishedArticle("community-update")).toMatchObject({
		id: 12n,
		title: "Current article",
		fullStory: "<p>Current body</p>",
	});
	state.fail = true;
	expect(await getPublishedArticle("community-update")).toMatchObject({
		id: 12n,
		title: "Current article",
	});
	expect(state.queries).toHaveLength(1);
});
