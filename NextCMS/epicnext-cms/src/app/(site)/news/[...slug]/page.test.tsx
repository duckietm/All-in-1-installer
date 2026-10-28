import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	missing: false,
	fail: false,
	sectionsFail: false,
}));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "7" } }) }));
vi.mock("@/actions/article-comments", () => ({ postComment: async () => {} }));
vi.mock("@/actions/article-reactions", () => ({
	toggleReaction: async () => {},
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/public-page-performance", () => ({
	withPublicPagePerformance: (_route: string, render: unknown) => render,
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw Error("ARTICLE_NOT_FOUND");
	},
}));
vi.mock("next-intl/server", () => ({
	getTranslations:
		async () => (key: string, values?: Record<string, unknown>) =>
			values ? `${key} ${Object.values(values).join(" ")}` : key,
}));
vi.mock("@/lib/services/news-cache", () => ({
	cacheNews: async (_key: string, _ttl: number, load: () => Promise<unknown>) =>
		load(),
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { drizzle } = await import("drizzle-orm/mysql-proxy");
	return {
		...schema,
		db: drizzle(async () => {
			throw Error("database offline");
		}),
	};
});
vi.mock("@/lib/services/news-detail", () => ({
	getPublishedArticle: async () => {
		if (state.fail) throw Error("database offline private connection details");
		if (state.missing) return null;
		return {
			id: 12n,
			slug: "community-update",
			title: "Community update",
			shortStory: "Summary",
			fullStory: "<p>Readable article body</p>",
			image: "",
			createdAt: new Date("2030-01-01T00:00:00Z"),
			updatedAt: null,
			publishAt: new Date("2030-02-01T00:00:00Z"),
			publishedAt: null,
		};
	},
	getArticleComments: async (_id: bigint, page: number | "last") => {
		if (state.sectionsFail) throw Error("comments offline");
		return {
			rows: [
				{
					id: 225n,
					userId: 7,
					comment: page === "last" ? "Newly posted comment" : "Earlier comment",
					username: "Member",
					createdAt: null,
				},
			],
			total: 225,
			page: page === "last" ? 9 : 1,
			perPage: 25,
			lastPage: 9,
		};
	},
	getArticleReactions: async () => {
		if (state.sectionsFail) throw Error("reactions offline");
		return { counts: new Map([["love", 2]]), myReaction: "love" };
	},
}));

import ArticlePage, { generateMetadata } from "./page";

beforeEach(() => {
	state.missing = false;
	state.fail = false;
	state.sectionsFail = false;
});
const renderPage = async (search: Record<string, string> = {}) =>
	renderToStaticMarkup(
		await ArticlePage({
			params: Promise.resolve({ slug: ["community-update"] }),
			searchParams: Promise.resolve(search),
		}),
	);

it("keeps the article readable with explicit failures for comments and reactions", async () => {
	state.sectionsFail = true;
	const html = await renderPage();
	expect(html).toContain("Readable article body");
	expect(html).toContain("commentsUnavailable");
	expect(html).toContain("reactionsUnavailable");
	expect(html).not.toContain("noComments");
	expect(html).not.toContain("noReactions");
	expect(html).not.toContain("aria-pressed");
});

it("shows recoverable article failures without producing a false 404 or exposing diagnostics", async () => {
	state.fail = true;
	const html = await renderPage();
	expect(html).toContain("loadError");
	expect(html).toContain("retry");
	expect(html).not.toContain("private connection details");
});

it("returns not found only when a successful lookup found no public article", async () => {
	state.missing = true;
	await expect(renderPage()).rejects.toThrow("ARTICLE_NOT_FOUND");
});

it("shows the newest comment after posting and preserves existing reaction controls", async () => {
	const html = await renderPage({ comment: "posted" });
	expect(html).toContain("Newly posted comment");
	expect(html).toContain("commentsPage=8#comments");
	expect(html).toContain("success.posted");
	expect(html).toContain('aria-pressed="true"');
	expect(html).toContain("2030-02-01");
	expect(html).not.toContain("2030-01-01");
});

it("loads metadata from the same public article service", async () => {
	expect(
		await generateMetadata({
			params: Promise.resolve({ slug: ["community-update"] }),
		}),
	).toMatchObject({ title: "Community update" });
});
