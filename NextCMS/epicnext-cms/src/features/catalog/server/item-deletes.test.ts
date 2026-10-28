import type { SQL } from "drizzle-orm";
import { int, MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	rows: [
		{
			id: 1,
			itemIds: "10",
			pageId: 4,
			catalogName: "Chair",
			costCredits: 3,
			costPoints: 10,
			pointsType: 5,
			amount: 1,
			limitedStack: 0,
			limitedSells: 0,
			orderNumber: 1,
			offerId: -1,
			songId: 0,
			extradata: "",
			haveOffer: "1",
			clubOnly: "0",
		},
		{
			id: 2,
			itemIds: "20",
			pageId: 4,
			catalogName: "Table",
			costCredits: 8,
			costPoints: 0,
			pointsType: 0,
			amount: 1,
			limitedStack: 0,
			limitedSells: 0,
			orderNumber: 2,
			offerId: -1,
			songId: 0,
			extradata: "",
			haveOffer: "1",
			clubOnly: "0",
		},
	],
	// Categories that still exist; a restore must not write offers onto
	// categories that are gone.
	pages: [4] as number[],
	// The BC table has six columns and no prices at all, which is exactly why it
	// needs its own column list rather than a filtered subset of the normal one.
	bcRows: [
		{
			id: 5,
			itemIds: "50",
			pageId: 7,
			catalogName: "BC Chair",
			orderNumber: 1,
			extradata: "",
		},
	] as Array<Record<string, unknown>>,
	bcPages: [7] as number[],
	audit: [] as Array<{
		id: number;
		action: string;
		target: string;
		userId: number;
		createdAt: string;
		before: string | null;
	}>,
	queries: [] as string[],
	nextAuditId: 900,
	failInsert: false,
	rollbacks: 0,
}));

/**
 * The restore lookup is the only audit read, and its condition is
 * `sql\`${AdminAuditLog.id}=?\``, so the id is the condition's only numeric chunk.
 */
function auditIdFromCondition(condition: unknown): number {
	// The id is the only numeric chunk. `FOR UPDATE` appends keyword chunks
	// rather than params, so the restore lookup still parses.
	const chunks = (condition as { queryChunks?: unknown[] }).queryChunks ?? [];
	for (const chunk of chunks) if (typeof chunk === "number") return chunk;
	return Number.NaN;
}

vi.mock("@/lib/db", async () => {
	const run = (query: SQL) => {
		const { sql: text, params } = new MySqlDialect().sqlToQuery(query);
		state.queries.push(text);
		return { text, params };
	};
	return {
		rowsFrom: (result: unknown) => (result as [unknown, unknown])[0] ?? [],
		// A real column, so `sql\`${AdminAuditLog.id}=?\`` compiles the way it does
		// in production and the mock can read the id back out of the chunks.
		AdminAuditLog: { id: int("id").notNull() },
		db: {
			execute: async (query: SQL) => {
				const compiled = new MySqlDialect().sqlToQuery(query);
				const text = compiled.sql;
				state.queries.push(text);
				// `LIMIT ?` is passed as a bound value by the dialect, so honour it
				// rather than returning everything and making the cap untested.
				const limit = Number(compiled.params.at(-1));
				const rows =
					Number.isFinite(limit) && limit > 0
						? state.audit.slice(-limit).reverse()
						: [...state.audit].reverse();
				return [rows, []];
			},
			transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
				const rowsBefore = structuredClone(state.rows);
				const bcRowsBefore = structuredClone(state.bcRows);
				const auditBefore = structuredClone(state.audit);
				const pagesBefore = [...state.pages];
				const bcPagesBefore = [...state.bcPages];
				try {
					return await fn({
						execute: async (query: SQL) => {
							const { text, params } = run(query);
							const isBc = text.includes("_bc");
							const rows = isBc ? state.bcRows : state.rows;
							if (text.startsWith("SELECT") && text.includes("catalog_pages")) {
								const pool = isBc ? state.bcPages : state.pages;
								return [
									pool
										.filter((id) =>
											params.some((param) => Number(param) === id),
										)
										.map((id) => ({ id })),
									[],
								];
							}
							if (text.startsWith("SELECT") && text.includes("catalog_items")) {
								const wanted = /FROM catalog_items(_bc)? WHERE id IN/.test(
									text,
								);
								return [
									wanted
										? rows.filter((row) =>
												params.some((param) => Number(param) === row.id),
											)
										: [],
									[],
								];
							}
							if (text.startsWith("DELETE FROM catalog_items_bc")) {
								for (const param of params)
									state.bcRows = state.bcRows.filter(
										(row) => row.id !== Number(param),
									);
								return [{ affectedRows: params.length }, []];
							}
							if (text.startsWith("DELETE FROM catalog_items")) {
								for (const param of params)
									state.rows = state.rows.filter(
										(row) => row.id !== Number(param),
									);
								return [{ affectedRows: params.length }, []];
							}
							if (text.startsWith("INSERT INTO catalog_items_bc")) {
								// Read the column names back out of the statement, so a
								// column the BC table does not have fails the test.
								const columns = text.slice(
									text.indexOf("(") + 1,
									text.indexOf(") VALUES"),
								);
								const names = columns
									.split(",")
									.map((name) => name.trim().replace(/`/g, ""));
								state.bcRows.push(
									Object.fromEntries(
										names.map((name, index) => [name, params[index]]),
									),
								);
								return [{ affectedRows: 1 }, []];
							}
							if (text.startsWith("INSERT INTO catalog_items")) {
								state.rows.push({
									id: Number(params[0]),
									itemIds: String(params[1]),
									pageId: Number(params[2]),
									catalogName: String(params[3]),
									costCredits: Number(params[4]),
									costPoints: Number(params[5]),
									pointsType: Number(params[6]),
									amount: Number(params[7]),
									limitedStack: Number(params[8]),
									limitedSells: Number(params[9]),
									orderNumber: Number(params[10]),
									offerId: Number(params[11]),
									songId: Number(params[12]),
									extradata: String(params[13]),
									haveOffer: String(params[14]),
									clubOnly: String(params[15]),
								});
								return [{ affectedRows: 1 }, []];
							}
							return [{ affectedRows: 1 }, []];
						},
						insert: () => ({
							values: async (value: Record<string, unknown>) => {
								if (state.failInsert) throw Error("audit unavailable");
								const id = state.nextAuditId++;
								state.audit.push({
									id,
									action: String(value.action),
									target: String(value.target),
									userId: Number(value.userId ?? 0),
									createdAt: String(value.createdAt ?? ""),
									before: (value.before ?? null) as string | null,
								});
								return [{ insertId: id }];
							},
						}),
						select: () => ({
							from: () => ({
								where: (condition: unknown) => ({
									limit: async () => {
										// The only select on the audit table is the restore
										// lookup, keyed by the id the delete returned.
										const id = auditIdFromCondition(condition);
										const entry = state.audit.find((row) => row.id === id);
										return entry ? [entry] : [];
									},
								}),
							}),
						}),
						// Awaitable, like a real delete builder: the code awaits the
						// `where()` result directly rather than calling `.execute()`.
						delete: () => ({
							where: (condition: unknown) => {
								const id = auditIdFromCondition(condition);
								state.audit = state.audit.filter((row) => row.id !== id);
								return Promise.resolve([{ affectedRows: 1 }, []]);
							},
						}),
					});
				} catch (error) {
					state.rows = rowsBefore;
					state.audit = auditBefore;
					state.pages = pagesBefore;
					state.bcRows = bcRowsBefore;
					state.bcPages = bcPagesBefore;
					state.rollbacks++;
					throw error;
				}
			},
		},
	};
});

vi.mock("@/features/operations/server", async () => {
	// `runOperation` normally owns the transaction; here it delegates to the same
	// mocked db so the real command body runs inside a real transaction scope.
	const { db } = await import("@/lib/db");
	return {
		runOperation: async (
			_input: unknown,
			work: (tx: unknown, id: string) => Promise<unknown>,
		) => (db as any).transaction((tx: unknown) => work(tx, "op-1")),
		enqueueEffect: vi.fn(),
	};
});

vi.mock("@/lib/foundation/request-context", () => ({
	getOperationContext: () => ({ operationId: "req-1" }),
}));

const {
	deleteCatalogItemsCommand,
	listRestorableDeletionsCommand,
	restoreDeletedCatalogItemsCommand,
} = await import("./item-deletes");

beforeEach(() => {
	state.rows = structuredClone([
		{
			id: 1,
			itemIds: "10",
			pageId: 4,
			catalogName: "Chair",
			costCredits: 3,
			costPoints: 10,
			pointsType: 5,
			amount: 1,
			limitedStack: 0,
			limitedSells: 0,
			orderNumber: 1,
			offerId: -1,
			songId: 0,
			extradata: "",
			haveOffer: "1",
			clubOnly: "0",
		},
		{
			id: 2,
			itemIds: "20",
			pageId: 4,
			catalogName: "Table",
			costCredits: 8,
			costPoints: 0,
			pointsType: 0,
			amount: 1,
			limitedStack: 0,
			limitedSells: 0,
			orderNumber: 2,
			offerId: -1,
			songId: 0,
			extradata: "",
			haveOffer: "1",
			clubOnly: "0",
		},
	] as typeof state.rows);
	state.audit = [];
	state.pages = [4];
	state.bcRows = [
		{
			id: 5,
			itemIds: "50",
			pageId: 7,
			catalogName: "BC Chair",
			orderNumber: 1,
			extradata: "",
		},
	];
	state.bcPages = [7];
	state.queries = [];
	state.nextAuditId = 900;
	state.failInsert = false;
	state.rollbacks = 0;
});

it("keeps every column so a delete can be undone", async () => {
	const result = await deleteCatalogItemsCommand([1], 7);

	expect(result.deleted).toBe(1);
	expect(state.rows.map((row) => row.id)).toEqual([2]);
	const entry = state.audit.at(-1);
	expect(entry?.action).toBe("catalog_items_delete_restore");
	expect(JSON.parse(entry?.before ?? "[]")).toEqual([
		expect.objectContaining({
			id: 1,
			itemIds: "10",
			catalogName: "Chair",
			costCredits: 3,
			haveOffer: "1",
		}),
	]);
});

it("restores the exact row that was removed", async () => {
	const { restoreId } = await deleteCatalogItemsCommand([1, 2], 7);
	expect(state.rows).toHaveLength(0);

	const restored = await restoreDeletedCatalogItemsCommand(restoreId, 7);

	expect(restored.restored).toBe(2);
	expect(state.rows.map((row) => row.id).sort()).toEqual([1, 2]);
	expect(state.rows.find((row) => row.id === 1)).toMatchObject({
		itemIds: "10",
		catalogName: "Chair",
		costCredits: 3,
		pointsType: 5,
	});
});

it("refuses to restore over an id another offer now uses", async () => {
	const { restoreId } = await deleteCatalogItemsCommand([1], 7);
	state.rows.push({
		id: 1,
		itemIds: "99",
		pageId: 4,
		catalogName: "Replacement",
		costCredits: 1,
		costPoints: 0,
		pointsType: 0,
		amount: 1,
		limitedStack: 0,
		limitedSells: 0,
		orderNumber: 1,
		offerId: -1,
		songId: 0,
		extradata: "",
		haveOffer: "1",
		clubOnly: "0",
	});

	await expect(restoreDeletedCatalogItemsCommand(restoreId, 7)).rejects.toThrow(
		/Other offers now use these ids/,
	);
	// The competing offer must survive the refused restore.
	expect(state.rows.find((row) => row.id === 1)?.catalogName).toBe(
		"Replacement",
	);
});

it("refuses to restore offers whose category is gone", async () => {
	const { restoreId } = await deleteCatalogItemsCommand([1], 7);
	// The category was deleted after the offers came out of it.
	state.pages = [];

	await expect(restoreDeletedCatalogItemsCommand(restoreId, 7)).rejects.toThrow(
		/no longer exist/,
	);
	// An offer pointing at nothing would sell nowhere and show under no page;
	// offer #1 stays deleted, and #2 was never touched.
	expect(state.rows.map((row) => row.id)).toEqual([2]);
});

it("restores normally when the category is still there", async () => {
	const { restoreId } = await deleteCatalogItemsCommand([1], 7);
	expect((await restoreDeletedCatalogItemsCommand(restoreId, 7)).restored).toBe(
		1,
	);
});

it("lists a past deletion after its toast window has gone", async () => {
	const { restoreId } = await deleteCatalogItemsCommand([1, 2], 7);

	const listed = await listRestorableDeletionsCommand();

	expect(listed).toHaveLength(1);
	expect(listed[0]).toMatchObject({ restoreId, offers: 2, staffId: 7 });
	// And it still restores from that record.
	expect((await restoreDeletedCatalogItemsCommand(restoreId, 7)).restored).toBe(
		2,
	);
	expect(await listRestorableDeletionsCommand()).toEqual([]);
	// The record is spent once the rows are back: a second restore cannot happen.
	expect(state.audit).toEqual([]);
});

it("caps how many past deletions it lists", async () => {
	await deleteCatalogItemsCommand([1], 7);
	await deleteCatalogItemsCommand([2], 7);
	expect(await listRestorableDeletionsCommand(1)).toHaveLength(1);
});

it("skips a corrupt record instead of failing the whole list", async () => {
	await deleteCatalogItemsCommand([1], 7);
	state.audit.push({
		id: 5000,
		action: "catalog_items_delete_restore",
		target: "catalog_items",
		userId: 7,
		createdAt: "",
		before: "{not json",
	});

	const listed = await listRestorableDeletionsCommand();

	expect(listed.map((row) => row.offers)).toEqual([1]);
});

it("deletes and restores a BC offer without touching the normal table", async () => {
	const { deleted, restoreId } = await deleteCatalogItemsCommand(
		[5],
		7,
		undefined,
		"bc",
	);

	expect(deleted).toBe(1);
	expect(state.bcRows).toHaveLength(0);
	// The normal catalog is a different table and must be untouched.
	expect(state.rows.map((row) => row.id)).toEqual([1, 2]);
	expect(state.audit.at(-1)?.target).toBe("catalog_items_bc");

	const restored = await restoreDeletedCatalogItemsCommand(restoreId, 7);
	expect(restored.restored).toBe(1);
	// Column names, because that is what the INSERT carries: proving the restore
	// writes the real columns is the point of the BC path existing separately.
	expect(state.bcRows[0]).toMatchObject({
		id: 5,
		item_ids: "50",
		// Numbers stay numbers through the audit JSON round trip.
		page_id: 7,
		catalog_name: "BC Chair",
		order_number: 1,
	});
	// Exactly the six columns the BC table has. A price column here would be an
	// unknown-column error against a real database.
	expect(Object.keys(state.bcRows[0]).sort()).toEqual([
		"catalog_name",
		"extradata",
		"id",
		"item_ids",
		"order_number",
		"page_id",
	]);
});

it("refuses a BC restore whose category is gone", async () => {
	const { restoreId } = await deleteCatalogItemsCommand(
		[5],
		7,
		undefined,
		"bc",
	);
	state.bcPages = [];

	await expect(restoreDeletedCatalogItemsCommand(restoreId, 7)).rejects.toThrow(
		/no longer exist/,
	);
	expect(state.bcRows).toHaveLength(0);
});

it("lists BC and normal deletions side by side", async () => {
	await deleteCatalogItemsCommand([1], 7);
	await deleteCatalogItemsCommand([5], 7, undefined, "bc");

	const listed = await listRestorableDeletionsCommand();

	expect(listed.map((row) => row.catalog)).toEqual(["bc", "normal"]);
});

it("deletes nothing when part of the selection is already gone", async () => {
	await expect(deleteCatalogItemsCommand([1, 99], 7)).rejects.toThrow();
	expect(state.rows.map((row) => row.id)).toEqual([1, 2]);
	expect(state.rollbacks).toBe(1);
});

it("keeps the delete when the restore record cannot be written", async () => {
	state.failInsert = true;

	await expect(deleteCatalogItemsCommand([1], 7)).rejects.toThrow();
	// Without a durable restore record the rows must come back, not be lost.
	expect(state.rows.map((row) => row.id)).toEqual([1, 2]);
});
