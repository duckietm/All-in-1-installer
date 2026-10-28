import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	rows: [
		{
			id: 1,
			catalogName: "Chair",
			pageId: 4,
			costCredits: 3,
			costPoints: 10,
			pointsType: 5,
		},
		{
			id: 2,
			catalogName: "Table",
			pageId: 4,
			costCredits: 8,
			costPoints: 0,
			pointsType: 0,
		},
	],
	pages: [
		{ id: 4, caption: "Source" },
		{ id: 9, caption: "Target" },
	],
	queries: [] as string[],
	writes: 0,
	audit: [] as Array<{ before: string; after: string; target: string }>,
	failAt: 0,
	commits: 0,
	rollbacks: 0,
}));
vi.mock("@/lib/db", async () => {
	const db = {
		execute: async () => [state.pages, []],
		transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
			const before = state.writes;
			const beforeRows = structuredClone(state.rows);
			const beforeAudit = [...state.audit];
			try {
				const result = await fn({
					execute: async (query: SQL) => {
						const { sql: text, params } = new MySqlDialect().sqlToQuery(query);
						state.queries.push(text);
						if (
							text.startsWith("SELECT") &&
							!text.includes("catalog_name") &&
							text.includes("catalog_items")
						) {
							const row = state.rows.find(
								(row) => row.id === Number(params.at(-1)),
							);
							return [
								row
									? [
											{
												pageId: String(row.pageId),
												costCredits: row.costCredits,
												costPoints: row.costPoints,
												pointsType: row.pointsType,
											},
										]
									: [],
								[],
							];
						}
						if (text.startsWith("SELECT"))
							return [
								text.includes("catalog_pages") ? state.pages : state.rows,
								[],
							];
						state.writes++;
						if (state.writes === state.failAt) throw Error("write failed");
						const row = state.rows.find(
							(row) => row.id === Number(params.at(-1)),
						);
						if (row) {
							const columns = {
								page_id: "pageId",
								cost_credits: "costCredits",
								cost_points: "costPoints",
								points_type: "pointsType",
							} as const;
							const assignments =
								text.split(" SET ")[1]?.split(" WHERE ")[0] ?? "";
							let index = 0;
							for (const assignment of assignments.split(", ")) {
								const name = assignment.match(
									/`([^`]+)`/,
								)?.[1] as keyof typeof columns;
								if (columns[name]) row[columns[name]] = Number(params[index++]);
							}
						}
						return [{ affectedRows: 1 }, []];
					},
					insert: () => ({
						values: async (entry: (typeof state.audit)[number]) => {
							state.audit.push(entry);
							return [{ insertId: 1000 + state.audit.length }];
						},
					}),
				});
				state.commits++;
				return result;
			} catch (error) {
				state.writes = before;
				state.rows = beforeRows;
				state.audit = beforeAudit;
				state.rollbacks++;
				throw error;
			}
		},
	};
	return {
		db,
		...(await import("@/test/db-helpers")).createDbHelpers(db.execute),
	};
});

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

import {
	applyBulkOffersCommand,
	listBulkOfferDestinationsCommand,
	previewBulkOffersCommand,
} from "./bulk-offers";

const input = {
	ids: [1, 2],
	changes: { costCredits: { mode: "add" as const, value: 1 }, pageId: 9 },
};
beforeEach(() => {
	state.rows = [
		{
			id: 1,
			catalogName: "Chair",
			pageId: 4,
			costCredits: 3,
			costPoints: 10,
			pointsType: 5,
		},
		{
			id: 2,
			catalogName: "Table",
			pageId: 4,
			costCredits: 8,
			costPoints: 0,
			pointsType: 0,
		},
	];
	state.pages = [
		{ id: 4, caption: "Source" },
		{ id: 9, caption: "Target" },
	];
	state.queries = [];
	state.audit = [];
	state.writes = 0;
	state.failAt = 0;
	state.commits = 0;
	state.rollbacks = 0;
});
it("previews all changes without a write", async () => {
	const p = await previewBulkOffersCommand(input);
	expect(p.changedCount).toBe(2);
	expect(p.rows[0].after).toEqual({
		pageId: 9,
		costCredits: 4,
		costPoints: 10,
		pointsType: 5,
	});
	expect(state.writes).toBe(0);
});
it("locks pages before offers and commits the entire batch", async () => {
	const p = await previewBulkOffersCommand(input);
	state.queries = [];
	await applyBulkOffersCommand(input, p.fingerprint);
	expect(state.writes).toBe(2);
	const locks = state.queries.filter((q) => q.includes("FOR UPDATE"));
	expect(locks[0]).toContain("catalog_pages");
	expect(locks[1]).toContain("catalog_items");
	expect(
		state.queries
			.filter((q) => q.startsWith("UPDATE"))
			.every((q) => !q.includes("cost_points")),
	).toBe(true);
});
it("refuses a price change on a BC offer, which has no price column", async () => {
	await expect(
		previewBulkOffersCommand(
			{
				ids: [1, 2],
				changes: { costCredits: { mode: "set", value: 5 } },
			},
			"bc",
		),
	).rejects.toThrow(/Builder Club offer has no price/);
	expect(state.writes).toBe(0);
});

it("refuses a currency change on a BC offer too", async () => {
	await expect(
		previewBulkOffersCommand({ ids: [1], changes: { pointsType: 5 } }, "bc"),
	).rejects.toThrow(/currency/);
});

it("allows a BC category move and writes no column BC lacks", async () => {
	const p = await previewBulkOffersCommand(
		{ ids: [1, 2], changes: { pageId: 9 } },
		"bc",
	);
	expect(p.changedCount).toBe(2);
	state.queries = [];
	await applyBulkOffersCommand(
		{ ids: [1, 2], changes: { pageId: 9 } },
		p.fingerprint,
		undefined,
		undefined,
		"bc",
	);
	// The read and the write both have to stay inside the BC table: reading from
	// BC and writing to normal is how a category move would silently corrupt the
	// wrong catalog.
	expect(state.queries.some((q) => q.includes("catalog_items_bc"))).toBe(true);
	expect(
		state.queries.some(
			(q) => q.startsWith("UPDATE") && !q.includes("catalog_items_bc"),
		),
	).toBe(false);
	expect(state.audit).toHaveLength(0);
});

it("refuses stale prices and changed intent before writing", async () => {
	const p = await previewBulkOffersCommand(input);
	state.rows[0].costCredits = 100;
	await expect(applyBulkOffersCommand(input, p.fingerprint)).rejects.toThrow(
		/changed/i,
	);
	expect(state.writes).toBe(0);
	state.rows[0].costCredits = 3;
	await expect(
		applyBulkOffersCommand({ ...input, changes: { pageId: 9 } }, p.fingerprint),
	).rejects.toThrow(/changed/i);
});
it("rolls back earlier updates if a later update fails", async () => {
	const p = await previewBulkOffersCommand(input);
	state.failAt = 2;
	await expect(applyBulkOffersCommand(input, p.fingerprint)).rejects.toThrow(
		"write failed",
	);
	expect(state.writes).toBe(0);
	expect(state.rollbacks).toBe(1);
});
it("rejects missing offers and destinations", async () => {
	state.rows.pop();
	await expect(previewBulkOffersCommand(input)).rejects.toThrow(/not found/i);
	state.rows.push({
		id: 2,
		catalogName: "Table",
		pageId: 4,
		costCredits: 8,
		costPoints: 0,
		pointsType: 0,
	});
	state.pages.pop();
	await expect(previewBulkOffersCommand(input)).rejects.toThrow(/not found/i);
});
it("rejects invalid resulting price before any update", async () => {
	await expect(
		previewBulkOffersCommand({
			ids: [1, 2],
			changes: { costCredits: { mode: "add", value: -5 } },
		}),
	).rejects.toThrow(/negative/i);
	expect(state.writes).toBe(0);
});
it("rejects renamed destination after preview", async () => {
	const p = await previewBulkOffersCommand(input);
	state.pages[1].caption = "Different";
	await expect(applyBulkOffersCommand(input, p.fingerprint)).rejects.toThrow(
		/changed/i,
	);
});

it("does not silently truncate destination choices", async () => {
	state.pages = Array.from({ length: 5001 }, (_, i) => ({
		id: i + 1,
		caption: `Category ${i + 1}`,
	}));
	await expect(listBulkOfferDestinationsCommand()).rejects.toThrow(/5000/);
});
it("does not update offers whose chosen values already match", async () => {
	const request = { ids: [1, 2], changes: { pageId: 4 } };
	const p = await previewBulkOffersCommand(request);
	expect(p.changedCount).toBe(0);
	await applyBulkOffersCommand(request, p.fingerprint);
	expect(state.writes).toBe(0);
});

it("records category-only bulk edits as restorable history and returns durable IDs", async () => {
	const request = { ids: [1, 2], changes: { pageId: 9 } };
	const preview = await previewBulkOffersCommand(request);
	expect(await applyBulkOffersCommand(request, preview.fingerprint, 7)).toEqual(
		{ changedCount: 2, historyIds: [1001, 1002] },
	);
	expect(state.audit).toHaveLength(2);
	expect(state.audit[0].target).toBe("catalog_offer");
	expect(JSON.parse(state.audit[0].before)).toMatchObject({
		pageId: "4",
		costCredits: 3,
	});
	expect(JSON.parse(state.audit[0].after)).toMatchObject({
		pageId: "9",
		costCredits: 3,
	});
});
