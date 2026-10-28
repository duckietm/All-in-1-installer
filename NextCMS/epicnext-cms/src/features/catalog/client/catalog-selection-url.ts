export interface CatalogSelection {
	rootId: number | null;
	pageId: number | null;
}
function positiveId(value: string | null) {
	if (!value || !/^\d+$/.test(value)) return null;
	const id = Number(value);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}
export function readCatalogSelection(url: URL): CatalogSelection {
	return {
		rootId: positiveId(url.searchParams.get("root")),
		pageId: positiveId(url.searchParams.get("category")),
	};
}
export function writeCatalogSelection(
	url: URL,
	selection: CatalogSelection,
): URL {
	const next = new URL(url);
	for (const [key, value] of [
		["root", selection.rootId],
		["category", selection.pageId],
	] as const) {
		if (value === null) next.searchParams.delete(key);
		else next.searchParams.set(key, String(value));
	}
	return next;
}
