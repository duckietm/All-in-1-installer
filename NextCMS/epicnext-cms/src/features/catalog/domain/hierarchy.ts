export interface HierarchyPage {
	id: number;
	parentId: number;
	orderNum?: number;
}
/** Root pages live under parent -1 or 0; both address the same sibling set. */
function isSiblingOf(page: HierarchyPage, parentId: number) {
	return parentId <= 0
		? page.parentId === -1 || page.parentId === 0
		: page.parentId === parentId;
}
export class CatalogConflict extends Error {}
export class CatalogInputError extends Error {}
export class CatalogNotFound extends Error {}
export function positiveId(id: number) {
	if (!Number.isSafeInteger(id) || id <= 0)
		throw new CatalogInputError("Invalid catalog ID");
}
export function assertParent(
	pages: readonly HierarchyPage[],
	pageId: number,
	parentId: number,
) {
	if (!Number.isSafeInteger(parentId) || parentId < -1)
		throw new CatalogInputError("Invalid parent category");
	const map = new Map(pages.map((page) => [page.id, page]));
	const visited = new Set<number>();
	let current = parentId;
	while (current > 0) {
		if (current === pageId || visited.has(current))
			throw new CatalogInputError(
				"Cannot move page: would create a circular hierarchy",
			);
		visited.add(current);
		const parent = map.get(current);
		if (!parent) throw new CatalogInputError("Parent category does not exist");
		current = parent.parentId;
	}
}
export function collectSubtree(
	pages: readonly HierarchyPage[],
	pageId: number,
): number[] {
	const children = new Map<number, number[]>();
	for (const page of pages) {
		const list = children.get(page.parentId) ?? [];
		list.push(page.id);
		children.set(page.parentId, list);
	}
	const seen = new Set<number>();
	const queue = [pageId];
	for (let index = 0; index < queue.length; index++) {
		const id = queue[index];
		if (seen.has(id)) continue;
		seen.add(id);
		queue.push(...(children.get(id) ?? []));
	}
	return [...seen];
}
export function validateSiblingOrder(
	pages: readonly HierarchyPage[],
	parentId: number,
	ids: readonly number[],
	expected: readonly number[],
) {
	const current = pages
		.filter((page) => isSiblingOf(page, parentId))
		.sort((a, b) => (a.orderNum ?? 0) - (b.orderNum ?? 0) || a.id - b.id)
		.map((page) => page.id);
	if (
		current.length !== expected.length ||
		current.some((id, index) => id !== expected[index])
	)
		throw new CatalogConflict(
			"The category order changed. Reload before trying again.",
		);
	if (
		ids.length !== current.length ||
		new Set(ids).size !== ids.length ||
		ids.some((id) => !current.includes(id))
	)
		throw new CatalogInputError(
			"A reorder must include every sibling exactly once",
		);
}

/**
 * Resolve the order number a newly created page should take under `parentId`.
 *
 * The emulator refuses to load a catalog whose siblings share an order number
 * ("sibling order N is used more than once"), yet nearly every creation path
 * passes a fixed 0. Honour an explicit request while it is still free, and
 * otherwise append after the last sibling so creating a page can never
 * introduce a duplicate in the first place.
 */
export function nextFreeSiblingOrder(
	pages: readonly HierarchyPage[],
	parentId: number,
	requested?: number,
): number {
	const orders = pages
		.filter((page) => isSiblingOf(page, parentId))
		.map((page) => page.orderNum ?? 0);
	const highest = orders.length ? Math.max(...orders) : 0;
	if (requested === undefined || !Number.isFinite(requested))
		return highest + 1;
	const wanted = Number(requested);
	return orders.includes(wanted) ? highest + 1 : wanted;
}
