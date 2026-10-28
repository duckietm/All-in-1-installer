import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	current: [
		{ pageId: "9", costCredits: 20, costPoints: 0, pointsType: 0 },
		{ pageId: "9", costCredits: 30, costPoints: 0, pointsType: 0 },
	],
	audit: [] as unknown[],
	queries: [] as string[],
}));
vi.mock("@/lib/db", async () => ({
	rowsFrom: (await import("@/test/db-helpers")).rowsFrom,
	db: {
		transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
			const saved = structuredClone(state.current);
			const savedAudit = [...state.audit];
			const tx = {
				select: () => ({
					from: () => ({
						where: (query: SQL) => ({
							limit: async () => {
								const id = Number(
									new MySqlDialect().sqlToQuery(query).params[0],
								);
								return [
									{
										id,
										action: "history_update",
										target: "catalog_offer",
										targetId: id,
										before: JSON.stringify({
											pageId: "4",
											costCredits: id * 10,
											costPoints: 0,
											pointsType: 0,
										}),
										after: JSON.stringify({
											pageId: "9",
											costCredits: (id + 1) * 10,
											costPoints: 0,
											pointsType: 0,
										}),
									},
								];
							},
						}),
					}),
				}),
				execute: async (query: SQL) => {
					const { sql: text, params } = new MySqlDialect().sqlToQuery(query);
					state.queries.push(text);
					if (text.includes("catalog_pages")) return [[{ id: 4 }, { id: 9 }]];
					const id = Number(params.at(-1));
					if (text.startsWith("SELECT")) return [[state.current[id - 1]]];
					state.current[id - 1] = {
						pageId: String(params[0]),
						costCredits: Number(params[1]),
						costPoints: Number(params[2]),
						pointsType: Number(params[3]),
					};
					return [{}];
				},
				insert: () => ({
					values: async (entry: unknown) => {
						state.audit.push(entry);
						return [{ insertId: 100 + state.audit.length }];
					},
				}),
			};
			try {
				return await fn(tx);
			} catch (error) {
				state.current = saved;
				state.audit = savedAudit;
				throw error;
			}
		},
	},
}));

import { db } from "@/lib/db";

vi.mock("@/features/operations/server", () => {
	return {
		runOperation: (
			_input: unknown,
			work: (tx: unknown, id: string) => Promise<unknown>,
		) => db.transaction((tx) => work(tx, "operation-fixture")),
		enqueueEffect: vi.fn(),
	};
});

import { undoBulkOffersCommand } from "./bulk-offers";

beforeEach(() => {
	state.current = [
		{ pageId: "9", costCredits: 20, costPoints: 0, pointsType: 0 },
		{ pageId: "9", costCredits: 30, costPoints: 0, pointsType: 0 },
	];
	state.audit = [];
	state.queries = [];
});
it("restores the whole batch and records each restore in history", async () => {
	expect(await undoBulkOffersCommand([2, 1], 7)).toEqual({ changedCount: 2 });
	expect(state.current.map((row) => row.pageId)).toEqual(["4", "4"]);
	expect(state.current.map((row) => row.costCredits)).toEqual([10, 20]);
	expect(state.audit).toHaveLength(2);
	expect(state.queries[0]).toContain("catalog_pages");
});
it("rolls back earlier restores and history when a later offer changed", async () => {
	state.current[1].costPoints = 99;
	await expect(undoBulkOffersCommand([1, 2], 7)).rejects.toThrow(/changed/);
	expect(state.current[0].costCredits).toBe(20);
	expect(state.current[1].costPoints).toBe(99);
	expect(state.audit).toHaveLength(0);
});
it("rejects duplicate history IDs and repeated undo", async () => {
	await expect(undoBulkOffersCommand([1, 1], 7)).rejects.toThrow(/Invalid/);
	await undoBulkOffersCommand([1, 2], 7);
	await expect(undoBulkOffersCommand([1, 2], 7)).rejects.toThrow(/changed/);
	expect(state.audit).toHaveLength(2);
});
