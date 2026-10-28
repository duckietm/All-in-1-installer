// Bulk-load >50 MB JSON into MariaDB in resumable chunks (2000 rows/batch).
//
// Drizzle multi-row INSERTs are wrapped in ONE statement per chunk, so a
// 50 MB dump becomes a few dozen statements instead of hundreds of thousands
// of round-trips — no connect/packet timeouts, no "Pulling schema from
// database..." freeze (that hang is introspection racing a saturated server).
//
// Usage (via pnpm, as required):
//   pnpm exec tsx scripts/bulk-import-json.ts \
//     --file=/var/www/Gamedata/.../FurnitureData.json [--chunk-size=2000]
//
// Input shapes supported automatically:
//   A) habbo furnidata_json   → { roomitemtypes:{furnitype:[…]}, wallitemtypes:{…} }
//   B) flat array of objects  → [ {…}, {…} ]
//
// Flags:
//   --file=<path>    JSON file to load (required)
//   --table=<name>   one of: furnidata | docs | texts (default: furnidata)
//   --category=<x>   category value for docs/texts tables
//   --source=<x>     source value for furnidata table (default: habbo)
//   --chunk-size=N   rows per multi-row INSERT (default: 2000)
//   --limit=N        stop after N rows (dry-test without loading everything)
//   --truncate       DELETE all rows for this table's source/category first
//
// Idempotent by default: rows re-import on their unique key with
// ON DUPLICATE KEY UPDATE, so interrupted runs resume safely.

import "./load-env";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
	GamedataDocs,
	GamedataFurnidata,
	GamedataTexts,
} from "@/db/schema-gamedata";
import { mysqlConnectionUrl } from "./db-url";

interface Args {
	file: string;
	table: "furnidata" | "docs" | "texts";
	category: string;
	source: string;
	chunkSize: number;
	limit: number;
	truncate: boolean;
}

const FURNIDATA_SECTIONS = {
	roomitemtypes: "s",
	flooritemtypes: "s",
	wallitemtypes: "i",
	effecttypes: "e",
} as const;

function parseArgs(raw: string[]): Args {
	const get = (name: string) => {
		const hit = raw.find((a) => a.startsWith(`--${name}=`));
		return hit?.slice(name.length + 3);
	};
	const has = (name: string) => raw.includes(`--${name}`);
	const file = get("file");
	if (!file) {
		console.error(
			"Usage: pnpm exec tsx scripts/bulk-import-json.ts --file=<path> [--table=furnidata|docs|texts] [--category=<x>] [--source=<x>] [--chunk-size=2000] [--limit=N] [--truncate]",
		);
		process.exit(1);
	}
	const table = (get("table") ?? "furnidata") as Args["table"];
	return {
		file: resolve(file),
		table,
		category: get("category") ?? "default",
		source: get("source") ?? "habbo",
		chunkSize: Number(get("chunk-size") ?? "2000"),
		limit: Number(get("limit") ?? "0"),
		truncate: has("truncate"),
	};
}

// A >50 MB file parses fine with a single JSON.parse (V8 string limit is far
// higher); streaming row-by-row would slow the seed down for no memory win.
async function readJsonFile(file: string): Promise<unknown> {
	const { readFile } = await import("node:fs/promises");
	return JSON.parse(await readFile(file, "utf8"));
}

interface NormalizedRow {
	[key: string]: unknown;
}

// Normalize any supported shape into a flat list of JSON documents.
function normalize(json: unknown, table: Args["table"]): NormalizedRow[] {
	if (table !== "furnidata") {
		if (Array.isArray(json)) return json as NormalizedRow[];
		throw new Error(`Expected a top-level array for --table=${table}`);
	}
	if (Array.isArray(json)) return json as NormalizedRow[];

	// habbo furnidata_json: { roomitemtypes: { furnitype: [...] }, ... }
	if (json && typeof json === "object") {
		const rows: NormalizedRow[] = [];
		for (const [section, kind] of Object.entries(FURNIDATA_SECTIONS)) {
			const block = (json as Record<string, unknown>)[section];
			if (!block || typeof block !== "object") continue;
			const list = (block as Record<string, unknown>).furnitype;
			if (!Array.isArray(list)) continue;
			for (const item of list) rows.push({ ...item, kind });
		}
		return rows;
	}
	throw new Error("Unsupported JSON shape: expected array or furnidata_json");
}

function toFurnidataRow(
	row: NormalizedRow,
	source: string,
): Record<string, unknown> {
	return {
		source,
		kind: (row.kind as "s" | "i" | "e") ?? "s",
		className: String(row.classname ?? row.className ?? ""),
		publicName: String(row.public_name ?? row.publicName ?? ""),
		spriteId: Number(row.id ?? 0),
		payload: JSON.stringify(row),
	};
}

function toDocsRow(
	row: NormalizedRow,
	category: string,
): Record<string, unknown> {
	const payload = JSON.stringify(row);
	return {
		category,
		docKey: String(row.key ?? row.docKey ?? row.id ?? ""),
		payload,
		payloadSha1: createHash("sha1").update(payload).digest("hex"),
	};
}

function toTextsRow(
	row: NormalizedRow,
	category: string,
): Record<string, unknown> {
	return {
		category,
		textKey: String(row.key ?? row.id ?? ""),
		value: String(row.value ?? row.text ?? row),
	};
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const url = process.env.DATABASE_URL;
	if (!url)
		throw new Error("DATABASE_URL is required (load-env.ts loaded .env)");

	const conn = await mysql.createConnection(mysqlConnectionUrl(url));
	const db = drizzle(conn);

	// Session bulk-load flags: worst case per chunk is a lost commit, not a
	// corrupt table. FOREIGN_KEY_CHECKS off keeps each 50 MB chunk off FK
	// validation work; UNIQUE_CHECK is a per-statement no-op vs ON DUPLICATE.
	await conn.query("SET SESSION FOREIGN_KEY_CHECKS=0");
	await conn.query("SET SESSION sql_mode='NO_ENGINE_SUBSTITUTION'");

	const tableRef =
		args.table === "furnidata"
			? GamedataFurnidata
			: args.table === "docs"
				? GamedataDocs
				: GamedataTexts;
	const keyWhere =
		args.table === "furnidata"
			? sql`${GamedataFurnidata.source} = ${args.source}`
			: args.table === "docs"
				? sql`${GamedataDocs.category} = ${args.category}`
				: sql`${GamedataTexts.category} = ${args.category}`;

	if (args.truncate) {
		await db.execute(sql`DELETE FROM ${tableRef} WHERE ${keyWhere}`);
		console.log(`[bulk] truncated rows for ${args.table}`);
	}

	console.log(`[bulk] reading ${args.file} …`);
	const json = await readJsonFile(args.file);
	const rows = normalize(json, args.table);
	console.log(`[bulk] parsed ${rows.length} documents (${args.table})`);

	const mapper: (r: NormalizedRow) => Record<string, unknown> =
		args.table === "furnidata"
			? (r) => toFurnidataRow(r, args.source)
			: args.table === "docs"
				? (r) => toDocsRow(r, args.category)
				: (r) => toTextsRow(r, args.category);

	const values = rows
		.slice(0, args.limit || rows.length)
		.map<Record<string, unknown>>(mapper);
	const total = values.length;
	const chunkSize = args.chunkSize;
	const started = Date.now();
	let inserted = 0;

	for (let i = 0; i < total; i += chunkSize) {
		const chunk = values.slice(i, Math.min(i + chunkSize, total));
		// `tableRef` is a 3-way union; drizzle's insert is typed per single
		// table, so narrow through a custom shape here (runtime is unaffected).
		const insert = db.insert(tableRef) as unknown as {
			values: (rows: typeof chunk) => {
				onDuplicateKeyUpdate: (opts: {
					set: Record<string, unknown>;
				}) => Promise<unknown>;
			};
		};
		await insert.values(chunk).onDuplicateKeyUpdate({
			// MariaDB `VALUES(col)` = the incoming row value; re-runs overwrite.
			set: Object.fromEntries(
				Object.keys(chunk[0] ?? {}).map((k) => [
					k,
					sql.raw(`values(\`${k}\`)`),
				]),
			),
		});

		inserted += chunk.length;
		const remaining = total - i - chunk.length;
		if (inserted % (chunkSize * 10) < chunkSize || remaining <= 0) {
			const elapsedSec = (Date.now() - started) / 1000;
			const rate = Math.round(inserted / Math.max(elapsedSec, 0.001));
			const etaMin = Math.round(remaining / Math.max(rate, 1) / 60);
			console.log(
				`[bulk] ${inserted}/${total} (${Math.round((inserted / total) * 100)}%) ${rate} rows/s, ETA ~${etaMin}m`,
			);
		}
	}

	const sec = ((Date.now() - started) / 1000).toFixed(1);
	console.log(`[bulk] DONE: ${inserted}/${total} rows in ${sec}s`);
	if (total === args.limit && args.limit > 0) {
		console.log(
			"  NOTE: --limit was set; run again without it for the full dump.",
		);
	}
	await conn.end();
}

main().catch((err) => {
	console.error("[bulk] FATAL:", err instanceof Error ? err.message : err);
	process.exit(1);
});
