import type { FurniItem } from "./studio-types";

interface FurnitureFilters {
	typeFilter: string;
	categoryFilter: string;
	statusFilter: string;
	sortBy: string;
}
export function filterFurniture(
	items: FurniItem[],
	{ typeFilter, categoryFilter, statusFilter, sortBy }: FurnitureFilters,
): FurniItem[] {
	let result = items;
	if (typeFilter !== "all") {
		result = result.filter((i) => i.type === typeFilter);
	}
	if (categoryFilter !== "all") {
		result = result.filter((i) => i.category === categoryFilter);
	}
	if (statusFilter === "imported")
		result = result.filter((i) => i.alreadyImported);
	else if (statusFilter === "inCatalog")
		result = result.filter((i) => i.alreadyImported && i.nitroExists);
	else if (statusFilter === "missingNitro")
		result = result.filter((i) => i.alreadyImported && !i.nitroExists);
	else if (statusFilter === "missingFurnidata")
		result = result.filter(
			(i) => i.alreadyImported && i.hasFurnidata === false,
		);
	else if (statusFilter === "missingCatalog")
		result = result.filter(
			(i) => i.alreadyImported && i.hasCatalogEntry === false,
		);
	else if (statusFilter === "notImported")
		result = result.filter((i) => !i.alreadyImported);
	const sorted = [...result];
	if (sortBy === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
	else if (sortBy === "classname")
		sorted.sort((a, b) => a.classname.localeCompare(b.classname));
	else if (sortBy === "category")
		sorted.sort((a, b) => (a.category || "").localeCompare(b.category || ""));
	else if (sortBy === "imported-first")
		sorted.sort(
			(a, b) => (b.alreadyImported ? 1 : 0) - (a.alreadyImported ? 1 : 0),
		);
	else if (sortBy === "not-imported-first")
		sorted.sort(
			(a, b) => (a.alreadyImported ? 1 : 0) - (b.alreadyImported ? 1 : 0),
		);
	return sorted;
}
