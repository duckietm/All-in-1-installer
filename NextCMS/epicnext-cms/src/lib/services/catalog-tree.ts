import { eq, sql } from "drizzle-orm";
import {
	deletePageCommand,
	updatePageCommand,
} from "@/features/catalog/server/page-commands";
import { CatalogPages, db, queryRows } from "@/lib/db";

export type { NestedTreeNode, TreeNode } from "@/types/catalog";

import type { NestedTreeNode, TreeNode } from "@/types/catalog";

function toInt(value: unknown, fallback = 0): number {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n : fallback;
}

/**
 * Count catalog_items per page via raw SQL.
 * Real Habbo DBs often store page_id as VARCHAR. String literals match both
 * INT and VARCHAR columns while keeping the page_id index usable (CAST(... AS CHAR)
 * would force a full index scan).
 */
export async function getCatalogItemCounts(
	pageIds?: number[],
): Promise<Map<number, number>> {
	const map = new Map<number, number>();
	try {
		if (pageIds && pageIds.length === 0) return map;

		if (pageIds) {
			const idStrs = pageIds.map(String);
			const rows = await queryRows<{
				page_id: string | number;
				cnt: number | bigint;
			}>(sql`
				SELECT page_id, COUNT(*) as cnt
				FROM catalog_items
				WHERE page_id IN (${sql.join(idStrs, sql`, `)})
				GROUP BY page_id
			`);
			for (const r of rows) {
				map.set(toInt(r.page_id), toInt(r.cnt));
			}
			return map;
		}

		const rows = await queryRows<{
			page_id: string | number;
			cnt: number | bigint;
		}>(sql`
			SELECT page_id, COUNT(*) as cnt FROM catalog_items GROUP BY page_id
		`);
		for (const r of rows) {
			map.set(toInt(r.page_id), toInt(r.cnt));
		}
	} catch {
		// Best-effort — never break the tree for count failures.
	}
	return map;
}

/**
 * Build a nested tree structure from flat nodes.
 */
export function buildNestedTree(
	flat: TreeNode[],
	rootParentId = -1,
): NestedTreeNode[] {
	const childrenMap = new Map<number, NestedTreeNode[]>();
	const nodeMap = new Map<number, NestedTreeNode>();

	for (const node of flat) {
		const nested: NestedTreeNode = { ...node, children: [] };
		nodeMap.set(node.id, nested);
		if (!childrenMap.has(node.parentId)) childrenMap.set(node.parentId, []);
		childrenMap.get(node.parentId)?.push(nested);
	}

	for (const node of nodeMap.values()) {
		node.children = childrenMap.get(node.id) ?? [];
	}

	return childrenMap.get(rootParentId) ?? [];
}

/**
 * Create a new catalog page.
 */
export async function createPage(data: {
	parentId: number;
	caption: string;
	captionSave?: string;
	pageLayout?: string;
	iconImage?: number;
	iconColor?: number;
	minRank?: number;
	orderNum?: number;
	visible?: string | boolean;
	enabled?: string | boolean;
}) {
	const visible =
		typeof data.visible === "boolean"
			? data.visible
				? "1"
				: "0"
			: (data.visible ?? "1");
	const enabled =
		typeof data.enabled === "boolean"
			? data.enabled
				? "1"
				: "0"
			: (data.enabled ?? "1");

	return db.insert(CatalogPages).values({
		caption: data.caption,
		parentId: data.parentId,
		pageLayout: data.pageLayout ?? "default_3x3",
		captionSave: (data.captionSave ?? data.caption).slice(0, 25),
		iconColor: data.iconColor ?? 0,
		iconImage: data.iconImage ?? 0,
		minRank: data.minRank ?? 1,
		orderNum: data.orderNum ?? 0,
		visible,
		enabled,
		clubOnly: "0",
		vipOnly: "0",
		pageHeadline: "",
		pageTeaser: "",
		includes: "",
	});
}

/**
 * Move a page to a new parent.
 * Validates against circular hierarchy (A → B → C → A).
 */
export async function movePage(
	pageId: number,
	newParentId: number,
): Promise<void> {
	await updatePageCommand("normal", pageId, { parentId: newParentId });
}
export async function deletePage(
	pageId: number,
	mode: "cascade" | "reparent" = "reparent",
) {
	return deletePageCommand("normal", pageId, mode);
}

/**
 * Get ancestors (breadcrumb) from root to the given page.
 */
export async function getAncestors(
	pageId: number,
): Promise<Array<{ id: number; caption: string }>> {
	const ancestors: Array<{ id: number; caption: string }> = [];
	let currentId = pageId;
	for (let i = 0; i < 50; i++) {
		const [page] = await db
			.select({
				id: CatalogPages.id,
				caption: CatalogPages.caption,
				parentId: CatalogPages.parentId,
			})
			.from(CatalogPages)
			.where(eq(CatalogPages.id, currentId))
			.limit(1);
		if (!page) break;
		ancestors.unshift({ id: page.id, caption: page.caption });
		if (page.parentId <= 0) break;
		currentId = page.parentId;
	}
	return ancestors;
}

export { toInt };
