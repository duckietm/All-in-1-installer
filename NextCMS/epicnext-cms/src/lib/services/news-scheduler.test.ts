// @ts-nocheck
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { format } from "mysql2";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	articles: [] as Array<{
		id: string;
		userId: number | null;
		title?: string;
		status: string;
		publishAt: Date;
	}>,
	queries: [] as Array<{ sql: string; params: unknown[] }>,
	operations: [] as unknown[][],
	effects: [] as unknown[][],
	failOutbox: false,
	transactionCalls: 0,
	failures: [] as Array<{ at: "select" | "outbox" | "commit"; error: unknown }>,
	loseRace: false,
	refresh: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("./news-cache", () => ({ invalidateNewsCache: state.refresh }));
vi.mock("@/lib/db", async () => {
	const dialect = new MySqlDialect();
	const timestamp = (value: unknown) =>
		value instanceof Date
			? value
			: new Date(`${String(value).replace(" ", "T")}Z`);
	const failAt = (at: "select" | "outbox" | "commit") => {
		if (state.failures[0]?.at === at) throw state.failures.shift()?.error;
	};
	const tx = {
		execute: async (query: SQL) => {
			const { sql, params } = dialect.sqlToQuery(query);
			state.queries.push({ sql, params });
			if (sql.startsWith("SELECT")) failAt("select");
			if (sql.startsWith("SELECT"))
				return [
					state.articles
						.filter(
							(a) =>
								a.status === "scheduled" && a.publishAt <= timestamp(params[0]),
						)
						.slice(0, 100),
				];
			if (sql.startsWith("UPDATE website_articles")) {
				const article = state.articles.find((a) => a.id === params[2]);
				if (
					state.loseRace ||
					!article ||
					article.status !== "scheduled" ||
					article.publishAt > timestamp(params[3])
				)
					return [{ affectedRows: 0 }];
				article.status = "published";
				return [{ affectedRows: 1 }];
			}
			if (sql.startsWith("INSERT INTO cms_operations"))
				state.operations.push(params);
			else if (sql.startsWith("INSERT INTO cms_outbox")) {
				failAt("outbox");
				if (state.failOutbox) throw Error("outbox unavailable");
				state.effects.push(params);
			} else throw Error(`Unexpected SQL ${sql}`);
			return [[]];
		},
	};
	return {
		rowsFrom: (await import("@/test/db-helpers")).rowsFrom,
		db: {
			transaction: async (work: (tx: unknown) => Promise<unknown>) => {
				state.transactionCalls++;
				const before = structuredClone({
					articles: state.articles,
					operations: state.operations,
					effects: state.effects,
				});
				let result: unknown;
				try {
					result = await work(tx);
				} catch (error) {
					Object.assign(state, before);
					throw error;
				}
				// A lost commit response may follow a durable commit: preserve its writes.
				failAt("commit");
				return result;
			},
		},
	};
});

import { publishDueArticles } from "./news-scheduler";

const now = new Date("2030-01-02T00:00:00Z");
beforeEach(() => {
	state.articles = [
		{
			id: "1",
			userId: 0,
			status: "scheduled",
			publishAt: new Date("2030-01-01T00:00:00Z"),
		},
	];
	state.queries = [];
	state.operations = [];
	state.effects = [];
	state.failOutbox = false;
	state.transactionCalls = 0;
	state.failures = [];
	state.loseRace = false;
	state.refresh.mockReset();
});
it("publishes once with the original legacy author and a durable cache refresh", async () => {
	expect(await publishDueArticles(now)).toBe(1);
	expect(await publishDueArticles(now)).toBe(0);
	expect(state.articles[0].status).toBe("published");
	expect(state.operations).toHaveLength(1);
	expect(state.operations[0][1]).toBe(0);
	expect(state.effects).toHaveLength(1);
	expect(state.effects[0][2]).toBe("news.refresh");
});
it("rolls publication back when durable cache enqueue fails", async () => {
	state.failOutbox = true;
	await expect(publishDueArticles(now)).rejects.toThrow("outbox unavailable");
	expect(state.articles[0].status).toBe("scheduled");
	expect(state.operations).toEqual([]);
	expect(state.effects).toEqual([]);
});
it("leaves future articles and concurrent changed articles alone", async () => {
	state.articles[0].publishAt = new Date("2031-01-01T00:00:00Z");
	expect(await publishDueArticles(now)).toBe(0);
	state.articles[0].publishAt = new Date("2030-01-01T00:00:00Z");
	state.loseRace = true;
	expect(await publishDueArticles(now)).toBe(0);
	expect(state.operations).toEqual([]);
	expect(state.effects).toEqual([]);
});
it("records real authors and represents missing legacy authors as system", async () => {
	state.articles[0].userId = null;
	state.articles.push({ ...state.articles[0], id: "2", userId: 42 });
	expect(await publishDueArticles(now)).toBe(2);
	expect(state.operations.map((row) => row[1])).toEqual([0, 42]);
});

it("reports committed publication even when immediate cache refresh fails", async () => {
	state.refresh.mockRejectedValue(Error("cache offline"));
	expect(await publishDueArticles(now)).toBe(1);
	expect(state.articles[0].status).toBe("published");
	expect(state.effects).toHaveLength(1);
	expect(state.refresh).toHaveBeenCalledOnce();
});

it("uses the same UTC cutoff and publication timestamps regardless of the MySQL client timezone", async () => {
	const instant = new Date("2030-06-01T08:09:10.123Z");
	expect(await publishDueArticles(instant)).toBe(1);
	const statements = state.queries.filter(
		({ sql }) =>
			sql.startsWith("SELECT") || sql.startsWith("UPDATE website_articles"),
	);
	expect(statements).toHaveLength(2);
	for (const statement of statements) {
		const values = statement.params.map((value) => {
			if (typeof value !== "string")
				throw new Error("Expected explicit SQL string parameters");
			return value;
		});
		expect(format(statement.sql, values, false, "+02:00")).toBe(
			format(statement.sql, values, false, "-07:00"),
		);
	}
	expect(statements[0].params).toEqual(["2030-06-01 08:09:10.123"]);
	expect(statements[1].params).toEqual([
		"2030-06-01 08:09:10.123",
		"2030-06-01 08:09:10.123",
		"1",
		"2030-06-01 08:09:10.123",
	]);
});

it("records the article title and exact identifier for the operation screen", async () => {
	state.articles[0].title = "Scheduled community news";
	await publishDueArticles(now);
	expect(JSON.parse(String(state.operations[0][5]))).toEqual({
		articleId: "1",
		articleTitle: "Scheduled community news",
		published: true,
	});
});

const deadlock = () =>
	Object.assign(new Error("Deadlock found"), {
		code: "ER_LOCK_DEADLOCK",
		errno: 1213,
	});
it.each(["select", "outbox"] as const)(
	"retries a rolled-back deadlock at %s with the same cutoff and one durable effect",
	async (at) => {
		state.failures = [
			{ at, error: new Error("Drizzle query failed", { cause: deadlock() }) },
		];
		expect(await publishDueArticles(now)).toBe(1);
		expect(state.transactionCalls).toBe(2);
		expect(state.articles[0].status).toBe("published");
		expect(state.operations).toHaveLength(1);
		expect(state.effects).toHaveLength(1);
		expect(state.refresh).toHaveBeenCalledOnce();
		const cutoffs = state.queries
			.filter(({ sql }) => sql.startsWith("SELECT"))
			.map(({ params }) => params[0]);
		expect(cutoffs).toEqual([
			"2030-01-02 00:00:00.000",
			"2030-01-02 00:00:00.000",
		]);
	},
);
it("bounds deadlock retries to three whole transactions and preserves the final error", async () => {
	const failure = deadlock();
	state.failures = Array.from({ length: 3 }, () => ({
		at: "outbox" as const,
		error: failure,
	}));
	await expect(publishDueArticles(now)).rejects.toBe(failure);
	expect(state.transactionCalls).toBe(3);
	expect(state.articles[0].status).toBe("scheduled");
	expect(state.operations).toHaveLength(0);
	expect(state.effects).toHaveLength(0);
	expect(state.refresh).not.toHaveBeenCalled();
});
it("recognizes the numeric MariaDB deadlock code through nested driver causes", async () => {
	state.failures = [
		{ at: "select", error: { cause: { cause: { errno: 1213 } } } },
	];
	expect(await publishDueArticles(now)).toBe(1);
	expect(state.transactionCalls).toBe(2);
});
it.each([
	Object.assign(new Error("lock wait timeout"), {
		code: "ER_LOCK_WAIT_TIMEOUT",
		errno: 1205,
	}),
	new Error("ER_LOCK_DEADLOCK in an untrusted message"),
	Object.assign(new Error("connection lost"), {
		code: "PROTOCOL_CONNECTION_LOST",
	}),
])("does not retry unrelated errors: %s", async (failure) => {
	state.failures = [{ at: "outbox", error: failure }];
	await expect(publishDueArticles(now)).rejects.toBe(failure);
	expect(state.transactionCalls).toBe(1);
	expect(state.operations).toHaveLength(0);
	expect(state.effects).toHaveLength(0);
});
it("never retries an unknown commit outcome", async () => {
	const failure = Object.assign(new Error("Commit response lost"), {
		code: "PROTOCOL_CONNECTION_LOST",
	});
	state.failures = [{ at: "commit", error: failure }];
	await expect(publishDueArticles(now)).rejects.toBe(failure);
	expect(state.transactionCalls).toBe(1);
	expect(state.operations).toHaveLength(1);
	expect(state.effects).toHaveLength(1);
	expect(state.refresh).not.toHaveBeenCalled();
});
it("bounds traversal of cyclic error causes", async () => {
	const failure: { cause?: unknown } = {};
	failure.cause = failure;
	state.failures = [{ at: "select", error: failure }];
	await expect(publishDueArticles(now)).rejects.toBe(failure);
	expect(state.transactionCalls).toBe(1);
});
