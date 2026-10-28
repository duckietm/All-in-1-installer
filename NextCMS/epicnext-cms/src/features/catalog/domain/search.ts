import { CatalogInputError } from "./hierarchy";
export type SearchCatalogKind = "normal" | "bc";
export interface CatalogSearchResult {
	kind: "category" | "offer";
	id: number;
	pageId: number;
	caption: string;
	path: string[];
	href: string;
	furniture?: { id: number; classname: string; spriteId: number };
}
export function validSearchQuery(query: string) {
	const value = query.trim();
	return query.length <= 100 && (value.length >= 2 || /^\d$/.test(value));
}
export function parseCatalogSearch(kind: string, query: string) {
	if (kind !== "normal" && kind !== "bc")
		throw new CatalogInputError("Invalid catalog type");
	if (!validSearchQuery(query))
		throw new CatalogInputError(
			"Search requires 2 to 100 characters or a numeric ID",
		);
	const value = query.trim();
	const parsed = /^\d+$/.test(value) ? Number(value) : NaN;
	const numericId = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
	return {
		kind,
		query: value,
		numericId,
		pattern: `${value.replace(/[=%_]/g, (char) => `=${char}`)}%`,
	};
}
