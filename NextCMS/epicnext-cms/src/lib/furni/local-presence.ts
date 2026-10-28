import { normalizeClassname } from "./classname";

export function indexLocalFurniture<T extends { id: number; itemName: string }>(
	rows: T[],
) {
	const index = new Map<string, T[]>();
	for (const row of rows) {
		const key = normalizeClassname(row.itemName);
		const matches = index.get(key) ?? [];
		matches.push(row);
		index.set(key, matches);
	}
	return index;
}
export function localFurnitureStatus(
	classname: string,
	local: Map<string, Array<{ id: number; itemName: string }>>,
	furnidata: Set<string>,
	catalogIds: Set<number>,
) {
	const key = normalizeClassname(classname);
	const rows = local.get(key) ?? [];
	return {
		alreadyImported: rows.length > 0,
		localId: rows.length === 1 ? rows[0].id : undefined,
		hasFurnidata: furnidata.has(key),
		hasCatalogEntry: rows.some((row) => catalogIds.has(row.id)),
	};
}
