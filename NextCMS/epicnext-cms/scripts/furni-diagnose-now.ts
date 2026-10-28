import "./load-env";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { CatalogItems, db, ItemsBase } from "@/lib/db";
import { bundleExistsInDir } from "@/lib/furni/bundle-file";
import { readFurniData } from "@/lib/services/furni-data";

const ICON_DIR = path.join(
	process.cwd(),
	"public",
	"swf",
	"dcr",
	"hof_furni",
	"icons",
);
const NITRO_DIR = path.join(
	process.cwd(),
	"public",
	"swf",
	"dcr",
	"hof_furni",
	"nitro",
);

function md5(p: string): string {
	return createHash("md5").update(readFileSync(p)).digest("hex");
}

async function main(): Promise<void> {
	// ── 1. DB state ──────────────────────────────────────────────────
	const [spriteDrift] = (await db.execute(
		sql`SELECT COUNT(*) AS n FROM items_base WHERE sprite_id <> id`,
	)) as unknown as [Array<{ n: number }>, unknown];
	console.log(
		`[1] items_base rows with sprite_id <> id: ${Number(spriteDrift[0]?.n ?? 0)}`,
	);

	const baseRows = await db
		.select({ id: ItemsBase.id, itemName: ItemsBase.itemName })
		.from(ItemsBase);
	console.log(`    items_base total: ${baseRows.length}`);

	const catRows = await db
		.select({
			id: CatalogItems.id,
			itemIds: CatalogItems.itemIds,
			catalogName: CatalogItems.catalogName,
		})
		.from(CatalogItems);
	console.log(`    catalog_items total: ${catRows.length}`);

	// catalog_items.item_ids -> dangling items_base refs
	let dangling = 0;
	let nameMismatch = 0;
	const nameById = new Map(baseRows.map((r) => [r.id, r.itemName]));
	for (const c of catRows) {
		const first = Number(String(c.itemIds ?? "").split(/[;,]/)[0]);
		if (!Number.isFinite(first) || !nameById.has(first)) {
			dangling++;
			continue;
		}
		if (c.catalogName && nameById.get(first) !== c.catalogName) nameMismatch++;
	}
	console.log(`[2] catalog_items with dangling item_ids: ${dangling}`);
	console.log(
		`    catalog_items with catalog_name <> items_base.item_name: ${nameMismatch}`,
	);

	// ── 2. Furnidata vs items_base ───────────────────────────────────
	const furniData = (await readFurniData()) as Record<
		string,
		{ furnitype?: Array<Record<string, unknown>> }
	>;
	interface Entry {
		id: number;
		classname: string;
		offerid: number;
	}
	const entries: Entry[] = [];
	const seenClass = new Map<string, number>();
	let dupClass = 0;
	for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
		for (const e of furniData[section]?.furnitype ?? []) {
			const id = Number(e?.id);
			const cn = typeof e?.classname === "string" ? e.classname : "";
			if (!Number.isFinite(id) || !cn) continue;
			if (seenClass.has(cn)) dupClass++;
			seenClass.set(cn, (seenClass.get(cn) ?? 0) + 1);
			entries.push({ id, classname: cn, offerid: Number(e?.offerid) });
		}
	}
	console.log(
		`[3] furnidata entries: ${entries.length} (duplicate classnames: ${dupClass})`,
	);

	const dbByClass = new Map(baseRows.map((r) => [r.itemName, r.id]));
	const dbById = new Map(baseRows.map((r) => [r.id, r.itemName]));
	let fdWrongId = 0;
	let _fdIdConflict = 0; // id belongs to a different classname in DB
	let fdMissingInDb = 0;
	const fdExamplesWrong: string[] = [];
	for (const e of entries) {
		const dbId = dbByClass.get(e.classname);
		if (dbId === undefined) {
			fdMissingInDb++;
			continue;
		}
		if (dbId !== e.id) {
			fdWrongId++;
			if (fdExamplesWrong.length < 10)
				fdExamplesWrong.push(
					`${e.classname}: furnidata id=${e.id} vs db id=${dbId}`,
				);
			continue;
		}
		if (dbById.get(e.id) !== e.classname) _fdIdConflict++;
	}
	console.log(
		`    furnidata entries whose id != items_base.id for same classname: ${fdWrongId}`,
	);
	console.log(
		`    furnidata entries not present in items_base at all: ${fdMissingInDb}`,
	);
	if (fdExamplesWrong.length)
		console.log(`      examples:\n      ${fdExamplesWrong.join("\n      ")}`);

	// items_base rows missing from furnidata
	const fdClasses = new Set(entries.map((e) => e.classname));
	const missingFd = baseRows.filter((r) => !fdClasses.has(r.itemName));
	console.log(
		`    items_base rows missing from furnidata: ${missingFd.length}`,
	);
	if (missingFd.length > 0)
		console.log(
			`      examples: ${missingFd
				.slice(0, 10)
				.map((r) => `${r.id}:${r.itemName}`)
				.join(", ")}`,
		);

	// ── 3. Assets on disk ────────────────────────────────────────────
	const catalogClasses = new Set<string>();
	for (const c of catRows) {
		const nm = nameById.get(Number(String(c.itemIds ?? "").split(/[;,]/)[0]));
		if (nm) catalogClasses.add(nm.replace(/\*/g, "_"));
	}

	const files = readdirSync(ICON_DIR);
	const iconSet = new Set(files);
	let missingIcons = 0;
	const missingIconExamples: string[] = [];
	for (const cls of catalogClasses) {
		const f = `${cls}_icon.png`;
		if (!iconSet.has(f)) {
			missingIcons++;
			if (missingIconExamples.length < 15) missingIconExamples.push(f);
		}
	}
	console.log(
		`[4] catalog items without local icon file: ${missingIcons} of ${catalogClasses.size}`,
	);
	if (missingIconExamples.length)
		console.log(`      examples: ${missingIconExamples.join(", ")}`);

	// duplicate-content icons across different classnames (suspicious downloads)
	const byHash = new Map<string, string[]>();
	for (const f of files) {
		if (!f.endsWith("_icon.png")) continue;
		const p = path.join(ICON_DIR, f);
		const st = statSync(p);
		if (st.size === 0) continue;
		const h = md5(p);
		const arr = byHash.get(h) ?? [];
		arr.push(f);
		byHash.set(h, arr);
	}
	let dupFiles = 0;
	const dupGroups: string[][] = [];
	for (const [, arr] of byHash) {
		if (arr.length < 2) continue;
		dupFiles += arr.length - 1;
		if (dupGroups.length < 8) dupGroups.push(arr);
	}
	console.log(
		`    byte-identical icon files across different classnames: ${dupFiles} extra copies`,
	);
	for (const g of dupGroups)
		console.log(
			`      ${g.slice(0, 6).join(" == ")}${g.length > 6 ? ` (+${g.length - 6} more)` : ""}`,
		);

	let nitroMissing = 0;
	for (const cls of catalogClasses) {
		if (!bundleExistsInDir(NITRO_DIR, cls)) nitroMissing++;
	}
	console.log(`[5] catalog items without a bundle on disk: ${nitroMissing}`);

	await db.$client.end();
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
