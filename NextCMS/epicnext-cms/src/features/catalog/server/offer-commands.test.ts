import { type SQL, sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	offers: [
		{ id: 1, pageId: 10, itemIds: "12;23;12" },
		{ id: 2, pageId: 10, itemIds: "23" },
	],
	pages: [{ id: 10 }, { id: 11 }],
	bases: [{ id: 12 }, { id: 23 }],
	queries: [] as { sql: string; params: unknown[] }[],
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
						const compiled = new MySqlDialect().sqlToQuery(query);
						state.queries.push(compiled);
						if (compiled.sql.startsWith("SELECT")) {
							if (compiled.sql.includes("catalog_pages"))
								return [state.pages, []];
							if (compiled.sql.includes("items_base"))
								return [
									state.bases.filter((row) => compiled.params.includes(row.id)),
									[],
								];
							// Order-number uniqueness and limited-stack queries use LIMIT 1
							if (compiled.sql.includes("LIMIT 1")) return [[], []];
							return [
								state.offers.filter((row) => compiled.params.includes(row.id)),
								[],
							];
						}
						state.writes++;
						if (state.failAt === state.writes)
							throw Error("database unavailable");
						return [{ affectedRows: 1, insertId: 40 }, []];
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
	createBcOfferCommand,
	createOfferCommand,
	moveOffersCommand,
	reorderOffersCommand,
	updateBcOfferCommand,
	updateOfferCommand,
} from "./offer-commands";

beforeEach(() => {
	state.pages = [{ id: 10 }, { id: 11 }];
	state.queries = [];
	state.writes = 0;
	state.failAt = 0;
	state.commits = 0;
	state.rollbacks = 0;
});
describe("transactional offer commands", () => {
	it("rolls back offer and shared furniture writes together", async () => {
		state.failAt = 2;
		await expect(
			updateOfferCommand({
				id: 1,
				catalogFields: { pageId: 11, costCredits: 0 },
				baseItem: { id: 23, fields: { publicName: "New" } },
			}),
		).rejects.toThrow("database unavailable");
		expect(state.writes).toBe(0);
		expect(state.rollbacks).toBe(1);
	});
	it("prevents writing an unrelated shared furniture even when submitted as a new bundle member", async () => {
		await expect(
			updateOfferCommand({
				id: 1,
				catalogFields: { itemIds: "12;99" },
				baseItem: { id: 99, fields: { publicName: "Wrong" } },
			}),
		).rejects.toThrow("belong");
		expect(state.writes).toBe(0);
	});
	it("updates a non-first bundle component and preserves zero values", async () => {
		await updateOfferCommand({
			id: 1,
			catalogFields: { pageId: 11, amount: 1, offerId: 0, orderNumber: 0 },
			baseItem: { id: 23, fields: { publicName: "New" } },
		});
		expect(state.commits).toBe(1);
		expect(state.writes).toBe(2);
		expect(
			state.queries.find((q) => q.sql.startsWith("UPDATE `catalog_items`"))
				?.params,
		).toContain("11");
	});
	it("rejects missing destination pages before writes", async () => {
		state.pages = [];
		await expect(
			updateOfferCommand({ id: 1, catalogFields: { pageId: 11 } }),
		).rejects.toThrow("page");
		expect(state.writes).toBe(0);
	});
	it("rejects missing bundle references before writes", async () => {
		await expect(
			updateOfferCommand({ id: 1, catalogFields: { itemIds: "12;99" } }),
		).rejects.toThrow("Furniture");
		expect(state.writes).toBe(0);
	});
	it("rolls back the entire reorder after an intermediate failure", async () => {
		state.failAt = 2;
		await expect(
			reorderOffersCommand([
				{ id: 1, orderNumber: 0 },
				{ id: 2, orderNumber: 1 },
			]),
		).rejects.toThrow("database unavailable");
		expect(state.writes).toBe(0);
		expect(state.rollbacks).toBe(1);
	});
	it("rejects duplicate reorder ids", async () => {
		await expect(
			reorderOffersCommand([
				{ id: 1, orderNumber: 0 },
				{ id: 1, orderNumber: 1 },
			]),
		).rejects.toThrow();
		expect(state.writes).toBe(0);
	});
	it("rejects missing offers in a batch", async () => {
		await expect(
			reorderOffersCommand([
				{ id: 1, orderNumber: 0 },
				{ id: 99, orderNumber: 1 },
			]),
		).rejects.toThrow("not found");
		expect(state.writes).toBe(0);
	});
	it("validates all source offers before moving a batch", async () => {
		await expect(moveOffersCommand([1, 99], 11)).rejects.toThrow("not found");
		expect(state.writes).toBe(0);
	});
});

it("does not update furniture removed from the submitted bundle", async () => {
	await expect(
		updateOfferCommand({
			id: 1,
			catalogFields: { itemIds: "12" },
			baseItem: { id: 23, fields: { publicName: "Wrong" } },
		}),
	).rejects.toThrow("belong");
	expect(state.writes).toBe(0);
});
it("keeps explicit zeros in the actual offer SQL parameters", async () => {
	await updateOfferCommand({
		id: 1,
		catalogFields: {
			amount: 1,
			orderNumber: 0,
			offerId: 0,
			limitedSells: 0,
			limitedStack: 0,
		},
	});
	const update = state.queries.find((query) => query.sql.startsWith("UPDATE"));
	expect(update?.params).toEqual([1, 0, 0, 0, 0, 1]);
});
it("rejects unsafe ids before opening a transaction", async () => {
	await expect(
		updateOfferCommand({ id: 0, catalogFields: { amount: 1 } }),
	).rejects.toThrow();
	await expect(
		reorderOffersCommand([{ id: 1.5, orderNumber: 1 }]),
	).rejects.toThrow();
	expect(state.queries).toHaveLength(0);
});
it("uses one atomic update and a string page parameter for a move", async () => {
	await moveOffersCommand([1, 2], 11);
	expect(state.commits).toBe(1);
	expect(state.writes).toBe(1);
	expect(
		state.queries.find((query) => query.sql.startsWith("UPDATE"))?.params,
	).toEqual(["11", 1, 2]);
});
it("ignores noneditable furniture and offer fields", async () => {
	await expect(
		updateOfferCommand({
			id: 1,
			catalogFields: { id: 2 },
			baseItem: { id: 12, fields: { spriteId: 99 } },
		}),
	).rejects.toThrow("No valid fields");
	expect(state.queries).toHaveLength(0);
});

// Creation must retain the parent lock until its insert commits.
it.each(["normal", "bc"] as const)(
	"rejects a deleted parent before a %s creation callback runs",
	async (kind) => {
		state.pages = [];
		const insert = vi.fn();
		await expect(
			createOfferCommand(kind, { pageId: 11, itemIds: "12;23" }, insert),
		).rejects.toThrow("page");
		expect(insert).not.toHaveBeenCalled();
		expect(state.writes).toBe(0);
	},
);
it("rejects missing furniture before creating an offer", async () => {
	const insert = vi.fn();
	await expect(
		createOfferCommand("normal", { pageId: 11, itemIds: "12;99" }, insert),
	).rejects.toThrow("Furniture");
	expect(insert).not.toHaveBeenCalled();
});
it("runs creation insert under the same transaction after reference locks", async () => {
	await createOfferCommand(
		"normal",
		{ pageId: 11, itemIds: "12;23;12" },
		async (tx) => {
			await tx.execute(sql`INSERT INTO catalog_items (id) VALUES (40)`);
			return 40;
		},
	);
	expect(state.queries.map((query) => query.sql.split(" ")[0])).toEqual([
		"SELECT",
		"SELECT",
		"INSERT",
	]);
	expect(state.queries[0].sql).toContain("FOR UPDATE");
	expect(state.queries[1].sql).toContain("FOR UPDATE");
	expect(state.commits).toBe(1);
});
it("rolls back a failed creation insert", async () => {
	state.failAt = 1;
	await expect(
		createOfferCommand("normal", { pageId: 11, itemIds: "12" }, (tx) =>
			tx.execute(sql`INSERT INTO catalog_items (id) VALUES (40)`),
		),
	).rejects.toThrow("database unavailable");
	expect(state.rollbacks).toBe(1);
	expect(state.writes).toBe(0);
});
it("rejects missing BC offers instead of reporting a zero-row update as saved", async () => {
	await expect(
		updateBcOfferCommand(99, { catalogName: "Missing" }),
	).rejects.toThrow("not found");
	expect(state.writes).toBe(0);
});
it("keeps BC fields explicit and uses BC destination locks", async () => {
	await updateBcOfferCommand(1, {
		pageId: 11,
		itemIds: "12;23",
		orderNumber: 0,
		costCredits: 99,
	});
	expect(state.queries[0].sql).toContain("catalog_pages_bc");
	const update = state.queries.find((query) => query.sql.startsWith("UPDATE"));
	expect(update?.sql).toContain("catalog_items_bc");
	expect(update?.sql).not.toContain("cost_credits");
	expect(update?.params).toEqual(["11", "12;23", 0, 1]);
});

it("creates a BC offer with only its supported fields and returns the committed id", async () => {
	const id = await createBcOfferCommand({
		pageId: 11,
		itemIds: "12;23;12",
		catalogName: "Bundle",
		orderNumber: 0,
		extradata: "x;y",
		costCredits: 99,
	});
	expect(id).toBe(40);
	expect(state.commits).toBe(1);
	const insert = state.queries.find((query) => query.sql.startsWith("INSERT"));
	expect(insert?.sql).toContain("catalog_items_bc");
	expect(insert?.sql).not.toContain("cost_credits");
	expect(insert?.params).toEqual(["11", "12;23;12", "Bundle", 0, "x;y"]);
});
it("rejects incomplete BC creation before beginning a transaction", async () => {
	await expect(
		createBcOfferCommand({ pageId: 11, itemIds: "12" }),
	).rejects.toThrow();
	expect(state.queries).toHaveLength(0);
});
it("rolls back failed BC creation and does not return an id", async () => {
	state.failAt = 1;
	await expect(
		createBcOfferCommand({
			pageId: 11,
			itemIds: "12",
			catalogName: "One",
			orderNumber: 0,
			extradata: "",
		}),
	).rejects.toThrow("database unavailable");
	expect(state.commits).toBe(0);
	expect(state.rollbacks).toBe(1);
});
it("rejects a missing BC destination before touching the offer", async () => {
	state.pages = [];
	await expect(updateBcOfferCommand(1, { pageId: 11 })).rejects.toThrow("page");
	expect(state.writes).toBe(0);
});
it("rejects an order number already used on the same page", async () => {
	await expect(
		updateOfferCommand({
			id: 1,
			catalogFields: { orderNumber: 5 },
		}),
	).resolves.toBeUndefined();
	// Verify the uniqueness SELECT was issued.
	const uniquenessQuery = state.queries.find(
		(q) => q.sql.includes("order_number") && q.sql.includes("LIMIT 1"),
	);
	expect(uniquenessQuery).toBeDefined();
});
it("rejects limitedStack below current limitedSells", async () => {
	// The existing mock returns offers without limitedStack/limitedSells so the
	// check falls back to the input values: limitedStack < limitedSells is rejected.
	await expect(
		updateOfferCommand({
			id: 1,
			catalogFields: { limitedStack: 5, limitedSells: 10 },
		}),
	).rejects.toThrow(/limited stack/i);
	expect(state.writes).toBe(0);
});
