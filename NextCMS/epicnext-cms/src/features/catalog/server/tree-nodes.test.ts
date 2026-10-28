import type { SQL } from "drizzle-orm";
import { int, MySqlDialect, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	pages: {
		normal: [] as Array<Record<string, unknown>>,
		bc: [] as Array<Record<string, unknown>>,
	},
	items: {
		normal: [] as Array<{ pageId: number }>,
		bc: [] as Array<{ pageId: number }>,
	},
	queries: [] as string[],
	countsShouldThrow: false,
}));

/** A grouped count is derived in the fake, so `groupBy()` resolves to rows. */
function groupedCounts(
	rows: Array<Record<string, unknown>>,
	key: string,
): Array<{ parentId: number; total: number }> {
	const counts = new Map<number, number>();
	for (const row of rows) {
		const id = Number(row[key]);
		counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	return [...counts].map(([parentId, total]) => ({ parentId, total }));
}

// Real drizzle tables, so `like()` and `eq()` compile into the same SQL the
// route sends in production and the fake below can filter on it.
const CatalogPages = mysqlTable("catalog_pages", {
	id: int("id").primaryKey(),
	parentId: int("parent_id"),
	caption: varchar("caption", { length: 100 }),
	pageLayout: varchar("page_layout", { length: 100 }),
	iconColor: int("icon_color"),
	iconImage: int("icon_image"),
	orderNum: int("order_num"),
	visible: varchar("visible", { length: 1 }),
	enabled: varchar("enabled", { length: 1 }),
});
const CatalogPagesBc = mysqlTable("catalog_pages_bc", {
	id: int("id").primaryKey(),
	parentId: int("parent_id"),
	caption: varchar("caption", { length: 100 }),
	pageLayout: varchar("page_layout", { length: 100 }),
	iconColor: int("icon_color"),
	iconImage: int("icon_image"),
	orderNum: int("order_num"),
	visible: varchar("visible", { length: 1 }),
	enabled: varchar("enabled", { length: 1 }),
});
const CatalogItems = mysqlTable("catalog_items", {
	id: int("id").primaryKey(),
	pageId: int("page_id"),
});
const CatalogItemsBc = mysqlTable("catalog_items_bc", {
	id: int("id").primaryKey(),
	pageId: int("page_id"),
});

vi.mock("@/lib/db", async () => {
	const tables = {
		CatalogPages,
		CatalogPagesBc,
		CatalogItems,
		CatalogItemsBc,
	};
	const tableOf = (table: unknown): string => {
		const symbol = Symbol.for("drizzle:Name");
		const holder = table as Record<symbol, string>;
		return holder?.[symbol] ?? "";
	};
	return {
		...tables,
		db: {
			select: () => ({
				from(table: unknown) {
					const name = tableOf(table);
					const isBc = name.includes("_bc");
					const rows = isBc ? state.pages.bc : state.pages.normal;
					// Real promises, awaited like the query builders they stand in
					// for; `.limit()` rides along on the resolved value.
					const group = Promise.resolve(groupedCounts(rows, "parentId"));
					// An item count groups by page_id over the whole table.
					const itemGroup = Promise.resolve(
						rows.length
							? state.items[isBc ? "bc" : "normal"].reduce<Map<number, number>>(
									(acc, item) =>
										acc.set(item.pageId, (acc.get(item.pageId) ?? 0) + 1),
									new Map(),
								)
							: new Map(),
					).then((map) =>
						[...map].map(([pageId, total]) => ({ pageId, total })),
					);
					const ordered = Object.assign(Promise.resolve(rows), {
						limit: async (limit?: number) =>
							rows.slice(0, limit ?? rows.length),
					});
					// `where` filters for real: the compiled text says whether it is a
					// caption LIKE, an id match or a parent lookup, and the params
					// carry the needle. Mocking it as a no-op would make every
					// search test pass for the wrong reason.
					const where = (condition: SQL) => {
						const { sql: text, params } = new MySqlDialect().sqlToQuery(
							condition,
						);
						state.queries.push(text);
						// A bare `id = ?` (one param) is the parent filter or an id
						// search; `id = ? or id = ?` is the two root sentinels.
						const matched = rows.filter((row) => {
							const parentMatches = (from: number) =>
								Number(row.parentId) === Number(params[from]);
							if (text.includes("caption")) {
								const needle = String(params[0] ?? "").replace(/^%|%$/g, "");
								const byCaption = String(row.caption)
									.toLowerCase()
									.includes(needle.toLowerCase());
								const byId =
									params.length > 1 && Number(row.id) === Number(params.at(-1));
								return byCaption || byId;
							}
							// Two params on the same column is the root sentinel
							// OR (-1 / 0), which still filters on parent_id.
							if (params.length === 2)
								return parentMatches(0) || parentMatches(1);
							if (text.includes("parent_id")) return parentMatches(0);
							if (params.length === 1)
								return Number(row.id) === Number(params[0]);
							return true;
						});
						const filtered = Object.assign(Promise.resolve(matched), {
							limit: async (limit?: number) =>
								matched.slice(0, limit ?? matched.length),
						});
						return {
							orderBy: () => filtered,
							groupBy: () => group,
							limit: filtered.limit,
						};
					};
					return {
						where,
						orderBy: () => ordered,
						groupBy: () => itemGroup,
						limit: ordered.limit,
					};
				},
			}),
		},
		queryRows: async () => [],
	};
});

vi.mock("@/lib/services/catalog-tree", () => ({
	// The normal catalog keeps its existing helper, including the VARCHAR-safe
	// string-literal count; the route must not grow a second count path.
	getCatalogItemCounts: async (ids?: number[]) => {
		if (state.countsShouldThrow) return new Map<number, number>();
		const counts = new Map<number, number>();
		for (const item of state.items.normal) {
			if (!ids || ids.includes(item.pageId))
				counts.set(item.pageId, (counts.get(item.pageId) ?? 0) + 1);
		}
		return counts;
	},
	getTreeFlat: async () => [{ id: 1, caption: "Root", parentId: -1, depth: 0 }],
}));

const { readChildren, searchPages, readFullTree } = await import(
	"./tree-nodes"
);

beforeEach(() => {
	state.queries = [];
	state.countsShouldThrow = false;
	state.pages.normal = [
		{
			id: 1,
			parentId: -1,
			caption: "Root",
			orderNum: 0,
			enabled: "1",
			visible: "1",
		},
		{
			id: 2,
			parentId: 1,
			caption: "Child",
			orderNum: 0,
			enabled: "1",
			visible: "1",
		},
	];
	state.pages.bc = [
		{
			id: 10,
			parentId: 0,
			caption: "BC Root",
			orderNum: 0,
			enabled: "1",
			visible: "1",
		},
		{
			id: 11,
			parentId: 10,
			caption: "BC Child",
			orderNum: 0,
			enabled: "1",
			visible: "1",
		},
	];
	state.items.normal = [{ pageId: 1 }, { pageId: 1 }, { pageId: 2 }];
	state.items.bc = [{ pageId: 10 }];
});

it("shapes BC children with the same counts as the normal catalog", async () => {
	const children = await readChildren("bc", 10);

	expect(children).toHaveLength(1);
	expect(children[0]).toMatchObject({
		id: 11,
		caption: "BC Child",
		childCount: 0,
		itemCount: 0,
		depth: 0,
	});
});

it("treats both root sentinels as roots", async () => {
	// BC installs use parent_id = 0, normal ones -1; neither is a real parent.
	expect((await readChildren("bc", 0)).map((n) => n.id)).toEqual([10]);
	expect((await readChildren("normal", -1)).map((n) => n.id)).toEqual([1]);
});

it("counts offers per page for both catalogs", async () => {
	const normal = await readChildren("normal", -1);
	expect(normal.find((n) => n.id === 1)?.itemCount).toBe(2);
});

it("keeps serving the tree when a count fails", async () => {
	state.countsShouldThrow = true;
	const children = await readChildren("normal", -1);
	expect(children.length).toBeGreaterThan(0);
	expect(children.every((n) => n.itemCount === 0)).toBe(true);
});

it("finds a category by caption and by exact id in both catalogs", async () => {
	expect((await searchPages("bc", "BC Child")).map((n) => n.id)).toEqual([11]);
	// A bare number is an id lookup, and must not fall back to a caption match.
	expect((await searchPages("normal", "2")).map((n) => n.id)).toEqual([2]);
	expect(await searchPages("normal", "999")).toEqual([]);
});

it("reads the whole normal tree through the same shaping as BC", async () => {
	const tree = await readFullTree("normal");
	expect(tree.map((n) => [n.id, n.depth, n.itemCount])).toEqual([
		[1, 0, 2],
		[2, 1, 1],
	]);
});

it("resolves depth for a BC tree in one read", async () => {
	const tree = await readFullTree("bc");
	expect(tree.map((n) => [n.id, n.depth])).toEqual([
		[10, 0],
		[11, 1],
	]);
});

it("does not hang on a parent cycle", async () => {
	state.pages.bc = [
		{
			id: 20,
			parentId: 21,
			caption: "A",
			orderNum: 0,
			enabled: "1",
			visible: "1",
		},
		{
			id: 21,
			parentId: 20,
			caption: "B",
			orderNum: 1,
			enabled: "1",
			visible: "1",
		},
	];
	const tree = await readFullTree("bc");
	expect(tree.every((n) => Number.isFinite(n.depth))).toBe(true);
});
