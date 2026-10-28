import type { TreeNode } from "@/types/catalog";

/** A catalog page the server just created, in the shape the live tree needs. */
export interface CreatedCatalogPage {
	id: number;
	caption: string;
	parentId: number;
	pageLayout: string;
	iconImage: number;
	iconColor: number;
	orderNum: number;
	enabled: string;
	visible: string;
}

/** catalog_items rows freshly inserted onto a page. */
export interface AddedCatalogItems {
	pageId: number;
	count: number;
}

/** catalog_items rows re-parented from one page onto another. */
export interface MovedCatalogItems {
	fromPageId: number;
	toPageId: number;
	count: number;
}

/**
 * Everything an import run changed in the catalog, expressed so the client can
 * fold it into the tree it already holds — no page reload needed.
 */
export interface CatalogTreeDelta {
	/** Genuinely new pages. Destination pages that already existed are omitted. */
	pages: CreatedCatalogPage[];
	/** Newly inserted offers, keyed by the page that received them. */
	addedItems: AddedCatalogItems[];
	/** Re-parented offers; these do not change the total item count. */
	movedItems: MovedCatalogItems[];
}

export const EMPTY_CATALOG_DELTA: CatalogTreeDelta = {
	pages: [],
	addedItems: [],
	movedItems: [],
};

export interface CatalogTotals {
	totalPages: number;
	enabledPages: number;
	totalItems: number;
}

/**
 * Coerce an API totals payload into CatalogTotals. An explicit all-zero payload
 * is valid (an empty catalog); a missing or partial one returns null so callers
 * keep whatever the store already holds.
 */
export function normalizeCatalogTotals(raw: unknown): CatalogTotals | null {
	if (!raw || typeof raw !== "object") return null;
	const row = raw as Record<string, unknown>;
	const { totalPages, totalItems, enabledPages } = row;
	if (
		totalPages === undefined ||
		totalItems === undefined ||
		enabledPages === undefined
	)
		return null;
	return {
		totalPages: toCount(totalPages),
		totalItems: toCount(totalItems),
		enabledPages: toCount(enabledPages),
	};
}

export function isEmptyCatalogDelta(delta: CatalogTreeDelta): boolean {
	return (
		delta.pages.length === 0 &&
		delta.addedItems.length === 0 &&
		delta.movedItems.length === 0
	);
}

function toCount(value: unknown): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

/**
 * Coerce an API tree payload into TreeNode. The route already answers with
 * TreeNode, but this keeps a malformed row from poisoning depth/count maths.
 */
export function normalizeTreePages(raw: unknown): TreeNode[] {
	if (!Array.isArray(raw)) return [];
	const nodes: TreeNode[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const row = entry as Record<string, unknown>;
		const id = toCount(row.id);
		if (id <= 0) continue;
		const parentId = toCount(row.parentId ?? -1);
		nodes.push({
			id,
			caption: String(row.caption ?? id),
			parentId: parentId || -1,
			depth: toCount(row.depth),
			orderNum: toCount(row.orderNum),
			enabled: String(row.enabled ?? "0"),
			visible: String(row.visible ?? "0"),
			iconImage: toCount(row.iconImage),
			iconColor: toCount(row.iconColor),
			pageLayout: String(row.pageLayout ?? "default_3x3"),
			childCount: toCount(row.childCount),
			itemCount: toCount(row.itemCount),
		});
	}
	return nodes;
}

/**
 * Recompute depth from parent links, mirroring the server's getTreeFlat:
 * roots sit at 0 and a looping parent chain stops at 0 instead of recursing
 * forever. The shared `chain` set is safe because every exit removes its id.
 */
export function recomputeDepth(nodes: TreeNode[]): TreeNode[] {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const depthOf = new Map<number, number>();
	const chain = new Set<number>();

	const resolve = (id: number): number => {
		const cached = depthOf.get(id);
		if (cached !== undefined) return cached;
		if (chain.has(id)) return 0;
		chain.add(id);
		const parentId = byId.get(id)?.parentId ?? -1;
		const depth =
			parentId > 0 && byId.has(parentId) ? resolve(parentId) + 1 : 0;
		chain.delete(id);
		depthOf.set(id, depth);
		return depth;
	};

	return nodes.map((node) => {
		const depth = resolve(node.id);
		return node.depth === depth ? node : { ...node, depth };
	});
}

function itemDeltas(delta: CatalogTreeDelta): Map<number, number> {
	const deltas = new Map<number, number>();
	const bump = (pageId: number, amount: number) => {
		if (amount === 0) return;
		deltas.set(pageId, (deltas.get(pageId) ?? 0) + amount);
	};
	for (const entry of delta.addedItems) {
		if (Number.isFinite(entry.pageId)) bump(entry.pageId, toCount(entry.count));
	}
	for (const entry of delta.movedItems) {
		if (entry.count <= 0) continue;
		if (Number.isFinite(entry.fromPageId)) bump(entry.fromPageId, -entry.count);
		if (Number.isFinite(entry.toPageId)) bump(entry.toPageId, entry.count);
	}
	return deltas;
}

/**
 * Fold a delta into a flat tree, returning the same array reference when the
 * delta changes nothing so consumers can rely on identity for memoisation.
 */
export function applyCatalogTreeDelta(
	tree: TreeNode[],
	delta: CatalogTreeDelta,
): TreeNode[] {
	if (isEmptyCatalogDelta(delta)) return tree;

	const counts = itemDeltas(delta);
	const known = new Set(tree.map((n) => n.id));
	const fresh: TreeNode[] = [];
	const childAdds = new Map<number, number>();
	for (const page of delta.pages) {
		if (known.has(page.id)) continue;
		known.add(page.id);
		fresh.push({ ...page, depth: 0, childCount: 0, itemCount: 0 });
		childAdds.set(page.parentId, (childAdds.get(page.parentId) ?? 0) + 1);
	}

	let next = tree;
	if (fresh.length > 0) {
		next = [...next, ...fresh].sort(
			(a, b) => a.orderNum - b.orderNum || a.id - b.id,
		);
		next = recomputeDepth(next);
	}
	if (counts.size === 0 && childAdds.size === 0) return next;

	return next.map((node) => {
		const itemDelta = counts.get(node.id) ?? 0;
		const childDelta = childAdds.get(node.id) ?? 0;
		if (itemDelta === 0 && childDelta === 0) return node;
		return {
			...node,
			itemCount: Math.max(0, node.itemCount + itemDelta),
			childCount: Math.max(0, node.childCount + childDelta),
		};
	});
}

/**
 * New offers raise the item total; re-parented ones only shift between pages.
 * Counts here are not derived from the tree, so totals stay correct even when
 * the live tree has not been loaded yet.
 */
export function applyCatalogTotals(
	totals: CatalogTotals,
	delta: CatalogTreeDelta,
): CatalogTotals {
	if (isEmptyCatalogDelta(delta)) return totals;
	const enabled = delta.pages.filter((p) => p.enabled !== "0").length;
	const items = delta.addedItems.reduce(
		(sum, entry) => sum + Math.max(0, toCount(entry.count)),
		0,
	);
	return {
		totalPages: totals.totalPages + delta.pages.length,
		enabledPages: totals.enabledPages + enabled,
		totalItems: totals.totalItems + items,
	};
}
