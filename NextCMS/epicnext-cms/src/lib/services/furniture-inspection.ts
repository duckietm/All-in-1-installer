import { promises as fs } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { queryRows } from "@/lib/db";
import { bundleFileNames } from "@/lib/furni/bundle-file";
import { normalizeClassname } from "@/lib/furni/classname";
import type { FurnitureInspection } from "@/lib/furni/studio-inspection";
import { getFurniAssetDirs } from "@/lib/services/furni-asset-dirs";
import { readFurniData } from "@/lib/services/furni-data";

async function asset(
	directory: string,
	name: string,
): Promise<{ exists: boolean | null; bytes: number }> {
	try {
		const stat = await fs.stat(path.join(directory, name));
		return {
			exists: stat.isFile() ? (stat.size > 0 ? true : null) : false,
			bytes: stat.size,
		};
	} catch (error) {
		return {
			exists: (error as NodeJS.ErrnoException).code === "ENOENT" ? false : null,
			bytes: 0,
		};
	}
}
async function assetCandidates(directory: string, names: string[]) {
	const results = await Promise.all(
		[...new Set(names)].map((name) => asset(directory, name)),
	);
	return (
		results.find((result) => result.exists === true) ??
		results.find((result) => result.exists === null) ??
		results[0]
	);
}

export async function inspectFurniture(
	names: string[],
): Promise<FurnitureInspection[]> {
	const namesSql = sql.join(
		names.map((name) => sql`${normalizeClassname(name)}`),
		sql`, `,
	);
	const rows = await queryRows<
		FurnitureInspection["sql"][number] & { classname: string }
	>(
		sql`SELECT id, sprite_id AS spriteId, item_name AS classname, public_name AS name, type FROM items_base WHERE LOWER(TRIM(item_name)) IN (${namesSql})`,
	);
	const offers = await queryRows<
		FurnitureInspection["catalog"][number] & { classname: string }
	>(
		sql`SELECT ib.item_name AS classname, ci.id, ci.page_id AS pageId, ci.cost_credits AS credits, ci.cost_points AS points FROM items_base ib JOIN catalog_items ci ON FIND_IN_SET(ib.id, REPLACE(ci.item_ids, ';', ',')) > 0 WHERE LOWER(TRIM(ib.item_name)) IN (${namesSql})`,
	);
	let readable = true;
	let data: Record<string, unknown> = {};
	try {
		data = await readFurniData();
	} catch {
		readable = false;
	}
	const entries = new Map<string, FurnitureInspection["furnidata"]>();
	for (const [section, type] of [
		["roomitemtypes", "flooritem"],
		["wallitemtypes", "wallitem"],
	] as const) {
		const list = (
			data[section] as
				| { furnitype?: Array<Record<string, unknown>> }
				| undefined
		)?.furnitype;
		if (!Array.isArray(list)) {
			readable = false;
			continue;
		}
		for (const entry of list) {
			if (!entry || typeof entry !== "object") {
				readable = false;
				continue;
			}
			const name = String(entry.classname ?? "");
			const key = normalizeClassname(name);
			if (!names.some((value) => normalizeClassname(value) === key)) continue;
			const values = entries.get(key) ?? [];
			values.push({
				id: Number(entry.id),
				name: String(entry.name ?? ""),
				description: String(entry.description ?? ""),
				revision: Number(entry.revision ?? 0),
				type,
			});
			entries.set(key, values);
		}
	}
	const dirs = await getFurniAssetDirs();
	const items: FurnitureInspection[] = [];
	for (let offset = 0; offset < names.length; offset += 20) {
		items.push(
			...(await Promise.all(
				names.slice(offset, offset + 20).map(async (classname) => {
					const variants = [
						classname,
						...rows
							.filter(
								(row) =>
									normalizeClassname(row.classname) ===
									normalizeClassname(classname),
							)
							.map((row) => row.classname),
					];
					const [nitro, icon] = await Promise.all([
						assetCandidates(
							dirs.nitroDir,
							variants.flatMap((name) => bundleFileNames(name.split("*")[0])),
						),
						assetCandidates(
							dirs.iconDir,
							variants.map((name) => `${name.replaceAll("*", "_")}_icon.png`),
						),
					]);
					return {
						classname,
						sql: rows.filter(
							(row) =>
								normalizeClassname(row.classname) ===
								normalizeClassname(classname),
						),
						catalog: offers.filter(
							(row) =>
								normalizeClassname(row.classname) ===
								normalizeClassname(classname),
						),
						furnidata: entries.get(normalizeClassname(classname)) ?? [],
						furnidataReadable: readable,
						nitro,
						icon,
					};
				}),
			)),
		);
	}
	return items;
}
