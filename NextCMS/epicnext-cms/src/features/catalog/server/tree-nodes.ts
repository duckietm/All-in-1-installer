import "server-only";
import { asc, count, eq, inArray, like, or, type SQL } from "drizzle-orm";
import {
	CatalogItems,
	CatalogItemsBc,
	CatalogPages,
	CatalogPagesBc,
	db,
} from "@/lib/db";
import { getCatalogItemCounts } from "@/lib/services/catalog-tree";
import type { TreeNode } from "@/types/catalog";

export type CatalogKind = "normal" | "bc";

export function toInt(value: unknown, fallback = 0): number {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n : fallback;
}

type PageRow = {
	id: number | string;
	parentId: number | string;
	caption: string;
	pageLayout: string | null;
	iconColor: number | string | null;
	iconImage: number | string | null;
	orderNum: number | string | null;
	visible: string | number | null;
	enabled: string | number | null;
};

function tables(kind: CatalogKind) {
	return kind === "bc"
		? { pages: CatalogPagesBc, items: CatalogItemsBc }
		: { pages: CatalogPages, items: CatalogItems };
}

/**
 * One shaping function for every tree read. The normal and BC catalogs have the
 * same columns and the same child/item counts; the earlier copies of this logic
 * had already drifted apart (one counted items through `getCatalogItemCounts`
 * with its error tolerance, the other inline and swallowed), so the divergence
 * was a matter of time.
 */
async function readPages(
	kind: CatalogKind,
	where: SQL | undefined,
	limit?: number,
): Promise<TreeNode[]> {
	const { pages, items } = tables(kind);
	const columns = {
		id: pages.id,
		parentId: pages.parentId,
		caption: pages.caption,
		pageLayout: pages.pageLayout,
		iconColor: pages.iconColor,
		iconImage: pages.iconImage,
		orderNum: pages.orderNum,
		visible: pages.visible,
		enabled: pages.enabled,
	};
	const rows = await db
		.select(columns)
		.from(pages)
		.where(where)
		.orderBy(asc(pages.orderNum), asc(pages.id))
		.limit(limit ?? 50);
	const ids = rows.map((row) => toInt(row.id));
	if (!ids.length) return [];

	const [childCounts, itemCounts] = await Promise.all([
		db
			.select({ parentId: pages.parentId, total: count() })
			.from(pages)
			.where(inArray(pages.parentId, ids))
			.groupBy(pages.parentId),
		// Normal counts through the shared helper because real Habbo DBs store
		// page_id as VARCHAR; BC uses the typed column and does not need it.
		kind === "bc"
			? db
					.select({ pageId: items.pageId, total: count() })
					.from(items)
					.where(inArray(items.pageId, ids))
					.groupBy(items.pageId)
					.catch(() => [])
			: getCatalogItemCounts(ids).then(
					(map) =>
						[...map].map(([pageId, total]) => ({ pageId, total })) as {
							pageId: number;
							total: number;
						}[],
				),
	]);
	const childMap = new Map(
		childCounts.map((row) => [toInt(row.parentId), Number(row.total)]),
	);
	const itemMap = new Map(
		itemCounts.map((row) => [toInt(row.pageId), Number(row.total)]),
	);
	return rows.map((row) => toTreeNode(row, childMap, itemMap));
}

function toTreeNode(
	row: PageRow,
	childMap: Map<number, number>,
	itemMap: Map<number, number>,
): TreeNode {
	const id = toInt(row.id);
	return {
		id,
		caption: row.caption,
		parentId: toInt(row.parentId, -1),
		depth: 0,
		orderNum: toInt(row.orderNum),
		enabled: String(row.enabled ?? "0"),
		visible: String(row.visible ?? "0"),
		iconImage: toInt(row.iconImage),
		iconColor: toInt(row.iconColor),
		pageLayout: row.pageLayout ?? "",
		childCount: childMap.get(id) ?? 0,
		itemCount: itemMap.get(id) ?? 0,
	};
}

/** Roots differ between Habbo installs, so both sentinels are treated as roots. */
export function rootFilter(kind: CatalogKind, parentId: number) {
	const { pages } = tables(kind);
	return parentId <= 0
		? or(eq(pages.parentId, -1), eq(pages.parentId, 0))
		: eq(pages.parentId, parentId);
}

export function readChildren(kind: CatalogKind, parentId: number) {
	return readPages(kind, rootFilter(kind, parentId));
}

export function searchPages(kind: CatalogKind, query: string) {
	const { pages } = tables(kind);
	const needle = query.trim();
	const exactId = Number.parseInt(needle, 10);
	const byId = Number.isFinite(exactId) && String(exactId) === needle;
	const conditions = [like(pages.caption, `%${needle}%`)];
	if (byId) conditions.push(eq(pages.id, exactId));
	return readPages(kind, or(...conditions), 50);
}

/**
 * The whole catalog in one read, with depth resolved. Depth needs the full set
 * in memory — a per-page walk would be one query per level, and the tree is the
 * one payload that grows with the catalog.
 *
 * Both catalogs go through the same shaping. An earlier version delegated the
 * normal catalog to `getTreeFlat` while computing BC here, which left two
 * implementations of the same output behind one function name.
 */
export async function readFullTree(kind: CatalogKind): Promise<TreeNode[]> {
	return readFlatFromMemory(
		await readAllPages(kind),
		await readAllItemCounts(kind),
	);
}

async function readAllItemCounts(
	kind: CatalogKind,
): Promise<Map<number, number>> {
	// Normal goes through the shared helper: real Habbo DBs store page_id as
	// VARCHAR, and only the string-literal form keeps that index usable.
	if (kind === "normal") return getCatalogItemCounts();
	const { items } = tables(kind);
	const rows = await db
		.select({ pageId: items.pageId, total: count() })
		.from(items)
		.groupBy(items.pageId)
		.catch(() => []);
	return new Map(rows.map((row) => [toInt(row.pageId), Number(row.total)]));
}

async function readAllPages(kind: CatalogKind): Promise<PageRow[]> {
	const { pages } = tables(kind);
	return db
		.select({
			id: pages.id,
			parentId: pages.parentId,
			caption: pages.caption,
			pageLayout: pages.pageLayout,
			iconColor: pages.iconColor,
			iconImage: pages.iconImage,
			orderNum: pages.orderNum,
			visible: pages.visible,
			enabled: pages.enabled,
		})
		.from(pages)
		.orderBy(asc(pages.orderNum), asc(pages.id)) as Promise<PageRow[]>;
}

function readFlatFromMemory(
	rows: PageRow[],
	itemCounts: Map<number, number>,
): TreeNode[] {
	const childCounts = new Map<number, number>();
	for (const row of rows) {
		const parentId = toInt(row.parentId, -1);
		childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + 1);
	}
	const pageMap = new Map(rows.map((row) => [toInt(row.id), row]));
	const depths = new Map<number, number>();
	const visitingGlobal = new Set<number>();

	function depth(id: number, visiting = visitingGlobal): number {
		const cached = depths.get(id);
		if (cached !== undefined) return cached;
		// Messy imports can leave a parent chain looping; stop rather than recurse.
		if (visiting.has(id)) return 0;
		visiting.add(id);
		const parentId = pageMap.has(id)
			? toInt(pageMap.get(id)?.parentId, -1)
			: -1;
		const value =
			!parentId || parentId <= 0 ? 0 : depth(parentId, visiting) + 1;
		visiting.delete(id);
		depths.set(id, value);
		return value;
	}

	return rows.map((row) => {
		const node = toTreeNode(row, childCounts, itemCounts);
		return { ...node, depth: depth(node.id) };
	});
}

export async function readPage(kind: CatalogKind, id: number) {
	const { pages } = tables(kind);
	const [page] = await db.select().from(pages).where(eq(pages.id, id)).limit(1);
	return page;
}

export async function readAncestors(kind: CatalogKind, id: number) {
	const { pages } = tables(kind);
	const chain: Array<{ id: number; caption: string }> = [];
	let currentId = id;
	// 50 levels, matching `getAncestors`. The old BC branch stopped at 20, which
	// truncated the breadcrumb on a deeply nested catalog.
	for (let i = 0; i < 50; i++) {
		const [page] = await db
			.select({
				id: pages.id,
				caption: pages.caption,
				parentId: pages.parentId,
			})
			.from(pages)
			.where(eq(pages.id, currentId))
			.limit(1);
		if (!page) break;
		chain.unshift({ id: toInt(page.id), caption: page.caption });
		if (toInt(page.parentId, -1) <= 0) break;
		currentId = toInt(page.parentId);
	}
	return chain;
}
