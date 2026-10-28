import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	rows: [
		{ id: 1, parentId: -1, orderNum: 1, caption: "Current" },
		{ id: 2, parentId: 1, orderNum: 1 },
		{ id: 3, parentId: 1, orderNum: 2 },
	],
	queries: [] as string[],
	writes: 0,
	failAt: 0,
	commits: 0,
	rollbacks: 0,
}));
vi.mock("@/lib/db", async () => ({
	rowsFrom: (await import("@/test/db-helpers")).rowsFrom,
	...(await import("@/db/schema")),
	db: {
		transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
			const saved = state.writes;
			try {
				const result = await fn({
					execute: async (query: SQL) => {
						const text = new MySqlDialect().sqlToQuery(query).sql;
						state.queries.push(text);
						if (text.startsWith("SELECT")) return [state.rows, []];
						state.writes++;
						if (state.failAt === state.writes)
							throw Error("database unavailable");
						return [{ insertId: 4, affectedRows: 1 }, []];
					},
				});
				state.commits++;
				return result;
			} catch (error) {
				state.writes = saved;
				state.rollbacks++;
				throw error;
			}
		},
	},
}));

import {
	deletePageCommand,
	reorderPagesCommand,
	updatePageCommand,
} from "./page-commands";

beforeEach(() => {
	state.queries = [];
	state.writes = 0;
	state.failAt = 0;
	state.commits = 0;
	state.rollbacks = 0;
});
describe.each(["normal", "bc"] as const)(
	"%s transactional commands",
	(kind) => {
		it("rejects stale category fields without overwriting another operator", async () => {
			await expect(
				updatePageCommand(kind, 1, { caption: "Mine" }, { caption: "Old" }),
			).rejects.toThrow("another operator");
			expect(state.writes).toBe(0);
		});
		it("accepts matching category fields", async () => {
			await updatePageCommand(
				kind,
				1,
				{ caption: "Mine" },
				{ caption: "Current" },
			);
			expect(state.commits).toBe(1);
		});
		it("rolls back an interrupted reorder", async () => {
			state.failAt = 2;
			await expect(
				reorderPagesCommand(kind, {
					parentId: 1,
					ids: [3, 2],
					expectedIds: [2, 3],
				}),
			).rejects.toThrow("database unavailable");
			expect(state.writes).toBe(0);
			expect(state.rollbacks).toBe(1);
			expect(state.queries[0]).toContain("ORDER BY id FOR UPDATE");
		});
		it("rejects stale reorder before any writes", async () => {
			await expect(
				reorderPagesCommand(kind, {
					parentId: 1,
					ids: [3, 2],
					expectedIds: [3, 2],
				}),
			).rejects.toThrow("changed");
			expect(state.writes).toBe(0);
		});
		it("rejects a cyclic parent through ordinary page editing", async () => {
			await expect(updatePageCommand(kind, 1, { parentId: 2 })).rejects.toThrow(
				"circular",
			);
			expect(state.writes).toBe(0);
		});
		it("rolls back reparent plus delete if the offer delete fails", async () => {
			state.failAt = 2;
			await expect(deletePageCommand(kind, 2, "reparent")).rejects.toThrow();
			expect(state.writes).toBe(0);
			expect(state.commits).toBe(0);
		});
		it("commits the entire subtree delete once", async () => {
			expect(await deletePageCommand(kind, 1, "cascade")).toEqual({
				deletedPages: 3,
				movedChildren: 0,
			});
			expect(state.commits).toBe(1);
			expect(state.writes).toBe(2);
		});
	},
);
