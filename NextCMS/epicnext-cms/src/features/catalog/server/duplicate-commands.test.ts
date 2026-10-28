import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	pages: [
		{ id: 1, parent_id: -1, caption: "Source", enabled: "1", includes: "2" },
		{ id: 2, parent_id: 1, caption: "Child", enabled: "1", includes: "" },
	],
	offers: [
		{
			id: 10,
			page_id: 2,
			item_ids: "8;8",
			cost_credits: 23,
			limited_stack: 10,
			offer_id: 10,
		},
	],
	bases: [{ id: 8 }],
	queries: [] as { sql: string; params: unknown[] }[],
	writes: 0,
	failAt: 0,
	commits: 0,
	rollbacks: 0,
}));
vi.mock("@/lib/services/furni-import", () => ({
	allocateCatalogItemId: async (fn: (id: number) => unknown) => fn(500),
}));
vi.mock("@/lib/db", async () => ({
	rowsFrom: (await import("@/test/db-helpers")).rowsFrom,
	db: {
		transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
			const saved = state.writes;
			try {
				const result = await fn({
					execute: async (query: SQL) => {
						const compiled = new MySqlDialect().sqlToQuery(query);
						state.queries.push(compiled);
						if (compiled.sql.startsWith("SELECT"))
							return [
								compiled.sql.includes("catalog_pages")
									? state.pages
									: compiled.sql.includes("items_base")
										? state.bases
										: state.offers,
								[],
							];
						state.writes++;
						if (state.writes === state.failAt) throw Error("Insert failed");
						return [
							{
								insertId: compiled.sql.includes("`catalog_items`")
									? 0
									: 100 + state.writes,
							},
							[],
						];
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
	duplicateCategoryCommand,
	previewDuplicateCommand,
} from "./duplicate-commands";

const input = {
	kind: "normal" as const,
	sourceId: 1,
	parentId: -1,
	name: "Copy",
};
beforeEach(() => {
	state.pages = [
		{ id: 1, parent_id: -1, caption: "Source", enabled: "1", includes: "2" },
		{ id: 2, parent_id: 1, caption: "Child", enabled: "1", includes: "" },
	];
	state.offers = [
		{
			id: 10,
			page_id: 2,
			item_ids: "8;8",
			cost_credits: 23,
			limited_stack: 10,
			offer_id: 10,
		},
	];
	state.bases = [{ id: 8 }];
	state.queries = [];
	state.writes = 0;
	state.failAt = 0;
	state.commits = 0;
	state.rollbacks = 0;
});
describe("atomic subtree duplication", () => {
	it("previews without writes and copies descendants, offers and internal references", async () => {
		const preview = await previewDuplicateCommand(input);
		expect(preview).toMatchObject({ pages: 2, offers: 1 });
		expect(state.writes).toBe(0);
		state.queries = [];
		await duplicateCategoryCommand(preview);
		const queries = state.queries;
		expect(queries.slice(0, 3).map((q) => q.sql)).toEqual([
			expect.stringContaining("catalog_pages"),
			expect.stringContaining("catalog_items"),
			expect.stringContaining("items_base"),
		]);
		expect(queries.slice(0, 3).every((q) => q.sql.endsWith("FOR UPDATE"))).toBe(
			true,
		);
		const inserts = queries.filter((q) => q.sql.startsWith("INSERT"));
		expect(inserts).toHaveLength(3);
		expect(inserts[0].params).toContain("0");
		expect(inserts[1].params).toContain(101);
		expect(inserts[1].params).toContain("1");
		expect(inserts[2].params.filter((p) => p === 500)).toHaveLength(2);
		expect(inserts[2].params).toEqual(
			expect.arrayContaining(["102", "8;8", 23, 10, 500]),
		);
		expect(queries.find((q) => q.sql.startsWith("UPDATE"))?.params).toEqual([
			"102",
			101,
		]);
		expect(state.pages[0].caption).toBe("Source");
	});
	it("detects stale source fields before any insert", async () => {
		const preview = await previewDuplicateCommand(input);
		state.offers[0].cost_credits = 99;
		await expect(duplicateCategoryCommand(preview)).rejects.toThrow("changed");
		expect(state.writes).toBe(0);
	});
	it("rolls back pages if an offer insert fails", async () => {
		const preview = await previewDuplicateCommand(input);
		state.failAt = 4;
		await expect(duplicateCategoryCommand(preview)).rejects.toThrow(
			"Insert failed",
		);
		expect(state.writes).toBe(0);
		expect(state.rollbacks).toBe(1);
	});
	it("rejects missing furniture without writes", async () => {
		state.bases = [];
		await expect(previewDuplicateCommand(input)).rejects.toThrow("Furniture");
		expect(state.writes).toBe(0);
	});
	it("copies BC with database-generated IDs and no added currency columns", async () => {
		const preview = await previewDuplicateCommand({ ...input, kind: "bc" });
		state.queries = [];
		await duplicateCategoryCommand(preview);
		const inserts = state.queries.filter((q) => q.sql.startsWith("INSERT"));
		expect(inserts[2].sql).toContain("catalog_items_bc");
		expect(inserts[2].sql).not.toMatch(/`id`=/);
		expect(inserts[0].sql).not.toContain("caption_save");
	});
});

it("invalidates the preview after the new root appears among destination siblings", async () => {
	const preview = await previewDuplicateCommand(input);
	const result = await duplicateCategoryCommand(preview);
	state.pages.push({
		id: result.id,
		parent_id: 0,
		caption: "Copy",
		enabled: "0",
		includes: "",
	});
	const writes = state.writes;
	await expect(duplicateCategoryCommand(preview)).rejects.toThrow("changed");
	expect(state.writes).toBe(writes);
});
