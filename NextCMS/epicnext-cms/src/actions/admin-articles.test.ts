// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	rows: [] as unknown[][],
	operations: new Map<
		string,
		{ id: string; requestHash: string; resultJson: string | null }
	>(),
	effects: [] as unknown[],
	insert: vi.fn(),
	update: vi.fn(),
	invalidate: vi.fn(),
	log: vi.fn(() => "news-error-1"),
	notify: vi.fn(),
}));
vi.mock("@/features/history/server", () => ({
	historySnapshot: async () => ({}),
	recordHistory: vi.fn(),
}));
vi.mock("@/lib/admin/guard", () => ({
	requirePermission: async () => ({ id: 1, username: "staff" }),
}));
vi.mock("@/lib/permissions", () => ({ PERMS: { NEWS_EDIT: "news.edit" } }));
vi.mock("@/lib/services/webhook", () => ({ notify: state.notify }));
vi.mock("@/lib/services/news-cache", () => ({
	invalidateNewsCache: state.invalidate,
}));
vi.mock("@/lib/logger", () => ({ logger: { error: state.log } }));
vi.mock("next-intl/server", () => ({
	getTranslations: async () => (key: string, args?: { reference: string }) =>
		key + (args?.reference ?? ""),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
	redirect: (url: string) => {
		throw Error(`redirect ${url}`);
	},
}));
vi.mock("@/lib/db", async () => {
	const { createDbHelpers } = await import("@/test/db-helpers");
	const { MySqlDialect } = await import("drizzle-orm/mysql-core");
	const dialect = new MySqlDialect();
	const database = {
		execute: async (statement: import("drizzle-orm").SQL) => {
			const { sql, params } = dialect.sqlToQuery(statement);
			if (sql.startsWith("INSERT INTO cms_operations")) {
				const [id, actor, kind, key, hash] = params;
				const identity = `${actor}:${kind}:${key}`;
				if (!state.operations.has(identity))
					state.operations.set(identity, {
						id: String(id),
						requestHash: String(hash),
						resultJson: null,
					});
			} else if (sql.startsWith("SELECT CAST(LAST_INSERT_ID() AS CHAR)")) {
				return [[{ id: "9007199254740993" }]];
			} else if (sql.startsWith("SELECT id,request_hash")) {
				return [[state.operations.get(params.join(":"))]];
			} else if (sql.startsWith("UPDATE cms_operations")) {
				const row = [...state.operations.values()].find(
					(row) => row.id === params[1],
				);
				if (row) row.resultJson = String(params[0]);
			} else if (sql.startsWith("INSERT INTO cms_outbox"))
				state.effects.push(params);
			else throw new Error(`Unexpected SQL: ${sql}`);
			return [[]];
		},
		select: () => ({
			from: () => ({
				where: () => ({
					limit: () => {
						const result = Promise.resolve(state.rows.shift() ?? []);
						return Object.assign(result, { for: () => result });
					},
				}),
			}),
		}),
		insert: () => ({ values: state.insert }),
		update: () => ({
			set: (value: unknown) => {
				state.update(value);
				return { where: async () => [{ affectedRows: 1 }] };
			},
		}),
		transaction: async (fn: (tx: unknown) => unknown): Promise<unknown> =>
			fn(database),
	};
	return {
		...(await import("@/db/schema")),
		...createDbHelpers(database.execute),
		db: database,
	};
});

import { articleEditToken } from "@/lib/article-edit-token";
import { createArticle, updateArticle } from "./admin-articles";

function form(extra: Record<string, string> = {}) {
	const f = new FormData();
	for (const [k, v] of Object.entries({
		requestKey: "11111111-1111-4111-8111-111111111111",
		title: "Test news",
		slug: "test-news",
		shortStory: "Summary",
		fullStory: "Body",
		status: "published",
		...extra,
	}))
		f.set(k, v);
	return f;
}
describe("news saves", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.rows = [];
		state.operations.clear();
		state.effects = [];
		state.invalidate.mockReset();
		state.insert.mockResolvedValue([{ insertId: 1 }]);
	});
	it("replays a committed creation without another article or notification", async () => {
		const first = await createArticle(form());
		const retry = await createArticle(form());
		expect(first.ok).toBe(true);
		expect(retry).toEqual(first);
		expect(state.insert).toHaveBeenCalledOnce();
		expect(state.notify).toHaveBeenCalledOnce();
		expect(state.effects).toHaveLength(1);
	});
	it("stores safe article context for background deliveries without the body", async () => {
		expect((await createArticle(form())).ok).toBe(true);
		const result = JSON.parse(
			[...state.operations.values()][0].resultJson ?? "null",
		);
		expect(result).toEqual({
			ok: true,
			articleId: "9007199254740993",
			articleTitle: "Test news",
		});
		expect(result).not.toHaveProperty("fullStory");
	});
	it("returns success when cache refresh fails after the article commits", async () => {
		state.invalidate.mockRejectedValue(Error("cache unavailable"));
		await expect(createArticle(form())).resolves.toMatchObject({ ok: true });
		expect(state.effects).toHaveLength(1);
	});
	it("rejects reuse of a committed request key with different content", async () => {
		expect((await createArticle(form())).ok).toBe(true);
		expect((await createArticle(form({ title: "Different" }))).ok).toBe(false);
		expect(state.insert).toHaveBeenCalledOnce();
	});
	it("preserves a recoverable error and logs its reference", async () => {
		state.insert.mockRejectedValueOnce(Error("Unknown column status"));
		const result = await createArticle(form());
		expect(result).toEqual({
			ok: false,
			error: "saveFailedReferencenews-error-1",
		});
		expect(state.invalidate).not.toHaveBeenCalled();
		expect(state.log).toHaveBeenCalled();
	});
	it("saves drafts without publication notifications", async () => {
		expect((await createArticle(form({ status: "draft" }))).ok).toBe(true);
		expect(state.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "draft",
				publishAt: null,
				publishedAt: null,
			}),
		);
		expect(state.notify).not.toHaveBeenCalled();
		expect(state.invalidate).toHaveBeenCalledOnce();
	});
	it("preserves the slug and clears old scheduling for immediate publication", async () => {
		const existing = {
			title: "Old",
			slug: "test-news",
			image: "",
			shortStory: "",
			fullStory: "",
			status: "draft",
			publishAt: null,
			publishedAt: null,
		};
		state.rows = [[existing]];
		expect(
			(
				await updateArticle(
					form({
						id: "1",
						baseToken: articleEditToken(existing),
						publishAt: "2099-01-01T00:00:00Z",
					}),
				)
			).ok,
		).toBe(true);
		expect(state.update).toHaveBeenCalledWith(
			expect.objectContaining({
				slug: "test-news",
				publishAt: null,
				status: "published",
			}),
		);
		expect(state.invalidate).toHaveBeenCalledOnce();
	});
	it("replays a committed update without stale-token failure or another revision", async () => {
		const existing = {
			title: "Old",
			slug: "test-news",
			image: "",
			shortStory: "",
			fullStory: "",
			status: "draft",
			publishAt: null,
			publishedAt: null,
		};
		state.rows = [[existing]];
		const data = form({ id: "1", baseToken: articleEditToken(existing) });
		const first = await updateArticle(data);
		expect(first.ok).toBe(true);
		expect(await updateArticle(data)).toEqual(first);
		expect(state.update).toHaveBeenCalledOnce();
		expect(state.insert).toHaveBeenCalledOnce();
		expect(state.notify).toHaveBeenCalledOnce();
		expect(state.effects).toHaveLength(1);
	});
	it("accepts long article bodies while detecting body changes on replay", async () => {
		const body = "a".repeat(100_000);
		expect((await createArticle(form({ fullStory: body }))).ok).toBe(true);
		expect((await createArticle(form({ fullStory: `${body}b` }))).ok).toBe(
			false,
		);
		expect(state.insert).toHaveBeenCalledOnce();
	});
	it("preserves the scheduled instant without publishing early", async () => {
		expect(
			(
				await createArticle(
					form({ status: "scheduled", publishAt: "2099-01-01T00:00:00Z" }),
				)
			).ok,
		).toBe(true);
		expect(state.insert).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "scheduled",
				publishAt: new Date("2099-01-01T00:00:00Z"),
				publishedAt: null,
			}),
		);
		expect(state.notify).not.toHaveBeenCalled();
	});
	it("does not report a committed article as failed when notification dispatch throws", async () => {
		state.notify.mockImplementationOnce(() => {
			throw Error("notification failure");
		});
		await expect(createArticle(form())).resolves.toMatchObject({ ok: true });
	});
	it("rejects an outdated editor without inserting a revision or overwriting the article", async () => {
		state.rows = [
			[
				{
					title: "Changed by another editor",
					slug: "test-news",
					image: "",
					shortStory: "",
					fullStory: "",
					status: "published",
					publishAt: null,
				},
			],
		];
		expect(
			await updateArticle(form({ id: "1", baseToken: "outdated" })),
		).toEqual({ ok: false, error: "editConflict" });
		expect(state.insert).not.toHaveBeenCalled();
		expect(state.update).not.toHaveBeenCalled();
		expect(state.invalidate).not.toHaveBeenCalled();
	});
	it("rejects invalid scheduled dates before writing", async () => {
		expect(
			(await createArticle(form({ status: "scheduled", publishAt: "invalid" })))
				.ok,
		).toBe(false);
		expect(state.insert).not.toHaveBeenCalled();
	});
});
