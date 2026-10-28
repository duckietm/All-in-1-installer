export interface FurnitureInspection {
	classname: string;
	sql: Array<{ id: number; spriteId: number; name: string; type: string }>;
	catalog: Array<{
		id: number;
		pageId: number;
		credits: number;
		points: number;
	}>;
	furnidata: Array<{
		id: number;
		name: string;
		description: string;
		revision: number;
		type: string;
	}>;
	furnidataReadable: boolean;
	nitro: { exists: boolean | null; bytes: number };
	icon: { exists: boolean | null; bytes: number };
}
export function validateClassnames(value: unknown): string[] | null {
	if (
		!Array.isArray(value) ||
		!value.length ||
		value.length > 500 ||
		value.some(
			(v) =>
				typeof v !== "string" || v.length > 200 || !/^[a-zA-Z0-9_*-]+$/.test(v),
		)
	)
		return null;
	return [...new Set(value)];
}
export function compareFurniture(
	source: { name: string; description: string; revision: number; type: string },
	local: FurnitureInspection,
) {
	const fd = local.furnidata[0],
		sql = local.sql[0];
	const values = [
		["Name", sql?.name ?? fd?.name, source.name],
		["Description", fd?.description, source.description],
		["Revision", fd?.revision, source.revision || undefined],
		[
			"Type",
			sql ? (sql.type === "i" ? "wallitem" : "flooritem") : fd?.type,
			source.type,
		],
	] as const;
	const fields = values.map(([label, before, after]) => ({
		label,
		before,
		after,
		changed:
			before !== undefined &&
			after !== undefined &&
			String(before) !== String(after),
	}));
	const state = hasFurnitureConflict(local)
		? "conflict"
		: !local.furnidataReadable
			? "unknown"
			: !sql && !fd
				? "new"
				: fields.some((f) => f.changed)
					? "changed"
					: "present";
	return { state, fields } as const;
}
export function furnitureHealth(local: FurnitureInspection) {
	const missing: string[] = [];
	if (local.nitro.exists === false) missing.push("Nitro");
	if (local.icon.exists === false) missing.push("Icon");
	if (local.furnidataReadable && !local.furnidata.length)
		missing.push("Furnidata");
	if (!local.sql.length) missing.push("SQL item");
	if (!local.catalog.length) missing.push("Catalog offer");
	const conflict = hasFurnitureConflict(local);
	const unknown =
		!local.furnidataReadable ||
		local.nitro.exists === null ||
		local.icon.exists === null;
	const state = conflict
		? "conflict"
		: unknown
			? "unknown"
			: !missing.length
				? "complete"
				: missing.length === 5
					? "new"
					: "incomplete";
	return { state, missing } as const;
}

export function hasFurnitureConflict(local: FurnitureInspection): boolean {
	const sql = local.sql[0],
		fd = local.furnidata[0];
	return (
		local.sql.length > 1 ||
		local.furnidata.length > 1 ||
		!!(
			sql &&
			fd &&
			(sql.spriteId !== fd.id ||
				(sql.type === "i" ? "wallitem" : "flooritem") !== fd.type)
		)
	);
}
