import {
	type FurnitureInspection,
	hasFurnitureConflict,
} from "./studio-inspection";
export type FurniturePartId =
	| "sql"
	| "catalog"
	| "furnidata"
	| "icon"
	| "nitro";
export interface FurniturePart {
	id: FurniturePartId;
	status: "present" | "missing" | "unknown" | "conflict";
	action: FurniturePartId | "recheck" | "audit" | null;
}
/** Report each required part without treating unavailable checks as missing data. */
export function furnitureCompleteness(
	local: FurnitureInspection,
): FurniturePart[] {
	const conflict = hasFurnitureConflict(local);
	const evidence: Array<[FurniturePartId, boolean | null]> = [
		["sql", local.sql.length > 0],
		["catalog", local.catalog.length > 0],
		["furnidata", local.furnidataReadable ? local.furnidata.length > 0 : null],
		["icon", local.icon.exists],
		["nitro", local.nitro.exists],
	];
	return evidence.map(([id, present]) => {
		if (conflict && (id === "sql" || id === "furnidata"))
			return { id, status: "conflict", action: "audit" };
		if (present === null) return { id, status: "unknown", action: "recheck" };
		return {
			id,
			status: present ? "present" : "missing",
			action: present ? null : id,
		};
	});
}
