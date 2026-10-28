import {
	assertParent,
	CatalogInputError,
	CatalogNotFound,
	collectSubtree,
	positiveId,
} from "./hierarchy";
export type DuplicateRow = Record<string, unknown> & {
	id: number;
	parent_id?: number;
};
export type DuplicateInput = {
	kind: "normal" | "bc";
	sourceId: number;
	parentId: number;
	name: string;
};
export type DuplicatePreview = DuplicateInput & {
	fingerprint: string;
	pages: number;
	offers: number;
	destination: string;
};
export function duplicateSubtree<T extends DuplicateRow>(
	pages: T[],
	sourceId: number,
	parentId: number,
): T[] {
	positiveId(sourceId);
	const source = pages.find((p) => Number(p.id) === sourceId);
	if (!source) throw new CatalogNotFound("Catalog category not found");
	const hierarchy = pages.map((p) => ({
		id: Number(p.id),
		parentId: Number(p.parent_id),
	}));
	assertParent(hierarchy, sourceId, Number(source.parent_id));
	assertParent(hierarchy, 0, parentId);
	const ids = collectSubtree(hierarchy, sourceId);
	if (ids.length > 500)
		throw new CatalogInputError("Duplicate at most 500 categories at a time");
	return ids.map((id) => pages.find((p) => Number(p.id) === id) as T);
}
export function remapIncludes(
	value: unknown,
	ids: Map<number, number>,
	existing: Set<number>,
): string {
	const text = String(value ?? "");
	if (!text.trim()) return text;
	return text
		.split(";")
		.map((part) => {
			const id = Number(part.trim());
			if (!/^\d+$/.test(part.trim()) || !existing.has(id))
				throw new CatalogInputError("Included category reference not found");
			return String(ids.get(id) ?? id);
		})
		.join(";");
}
