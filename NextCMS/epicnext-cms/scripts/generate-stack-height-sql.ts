import "./load-env";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
	autoDetectInteraction,
	nitroAnimationStatesCount,
} from "@/lib/furni/auto-interaction";
import { parseNitroBundle } from "@/lib/services/swf/nitro-builder";

/**
 * Generate a plain SQL file that repairs every furniture row in `items_base`
 * from the visual logic inside each `.hab` / `.nitro` bundle:
 *
 *   width / length / stack_height  ←  logic.model.dimensions x/y/z
 *   allow_stack                    ←  z > 0
 *   allow_sit / allow_lay / allow_walk  ←  furnidata flags (cansiton/canlayon/canstandon)
 *   interaction_modes_count        ←  real nitro animation states / mechanic
 *   interaction_type               ←  logicType + classname mechanic (only fills 'default')
 *
 * The dimensions are NOT in furnidata — they live in the bundle JSON at
 * `logic.model.dimensions` (or top-level `dimensions` for official bundles).
 * The interaction columns mirror `verifyAndFixInteractionModesCount`
 * (src/lib/services/furni-import.ts:1341): real furnidata flags + .nitro states,
 * and `interaction_type` is only touched when it is still `default`.
 *
 * Usage:
 *   pnpm exec tsx scripts/generate-stack-height-sql.ts [options]
 *
 * Options:
 *   --dir=<path>        bundle directory (default: /var/www/gamedata/bundled/furniture)
 *   --furnidata=<path>  local FurnitureData.json (default: /var/www/gamedata/config/FurnitureData.json)
 *   --out=<path>        SQL output file     (default: stack-heights.sql)
 *   --types=<list>      items_base types    (default: s,i  → floor + wall furniture)
 *   --all               emit every matched row instead of only changed rows
 *   --no-interaction    dimensions/allow_stack only, skip interaction columns
 *
 * Nothing in the database is modified here; you run the generated file yourself.
 */

const args = new Map<string, string | true>();
for (const raw of process.argv.slice(2)) {
	const eq = raw.indexOf("=");
	if (eq === -1) args.set(raw.replace(/^--/, ""), true);
	else args.set(raw.slice(2, eq), raw.slice(eq + 1));
}

const DIR = String(args.get("dir") ?? "/var/www/gamedata/bundled/furniture");
const FURNIDATA = String(
	args.get("furnidata") ?? "/var/www/gamedata/config/FurnitureData.json",
);
const OUT = String(args.get("out") ?? "stack-heights.sql");
const TYPES = String(args.get("types") ?? "s,i")
	.split(",")
	.map((t) => t.trim())
	.filter(Boolean);
const EMIT_ALL = args.has("all");
const WITH_INTERACTION = !args.has("no-interaction");

const EXTENSIONS = [".hab", ".nitro"] as const;

interface Dims {
	x: number;
	y: number;
	z: number;
}

interface Flags {
	cansiton: boolean;
	canlayon: boolean;
	canstandon: boolean;
}

interface BundleInfo {
	dims: Dims | null;
	animationStates: number | undefined;
	logicType: string | undefined;
}

interface Row {
	item_name: string;
	public_name: string;
	width: number;
	length: number;
	stack_height: number;
	allow_stack: number | string;
	allow_sit: number | string;
	allow_lay: number | string;
	allow_walk: number | string;
	interaction_type: string;
	interaction_modes_count: number;
}

/** Escape a value for a single-quoted MySQL string literal. */
function q(value: string): string {
	return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

/** `enum('0','1')` values must be quoted — an unquoted 0 is read as index 0 (''). */
function qbit(value: boolean): string {
	return value ? "'1'" : "'0'";
}

function isTruthyBit(value: number | string): boolean {
	return Number(value) === 1;
}

/** Pull dimensions out of a parsed bundle JSON, tolerating both layouts. */
function extractDims(json: unknown): Dims | null {
	const root = json as Record<string, unknown> | null;
	if (!root) return null;
	const logic = root.logic as Record<string, unknown> | undefined;
	const model = logic?.model as Record<string, unknown> | undefined;
	const candidate =
		(model?.dimensions as Dims | undefined) ??
		(logic?.dimensions as Dims | undefined) ??
		(root.dimensions as Dims | undefined);
	if (!candidate) return null;
	const x = Number(candidate.x);
	const y = Number(candidate.y);
	const z = Number(candidate.z);
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
		return null;
	}
	return { x, y, z };
}

/** Parse a bundle once and cache everything we need from it. */
function readBundleInfo(path: string): BundleInfo {
	try {
		const json = parseNitroBundle(readFileSync(path)).json as Record<
			string,
			unknown
		>;
		return {
			dims: extractDims(json),
			animationStates: nitroAnimationStatesCount(json),
			logicType:
				typeof json.logicType === "string" ? json.logicType : undefined,
		};
	} catch {
		return { dims: null, animationStates: undefined, logicType: undefined };
	}
}

/**
 * Read the local FurnitureData.json into a classname → flags map. Duplicate
 * classnames are merged so a true flag in any entry wins (same rule as the
 * app's `lookupRealFurniFlags`).
 */
function loadFurniFlags(path: string): Map<string, Flags> {
	const map = new Map<string, Flags>();
	if (!existsSync(path)) return map;
	try {
		const json = JSON.parse(readFileSync(path, "utf-8")) as Record<
			string,
			{ furnitype?: Array<Record<string, unknown>> }
		>;
		for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
			for (const item of json[section]?.furnitype ?? []) {
				const cn = item.classname;
				if (typeof cn !== "string" || !cn) continue;
				const candidate: Flags = {
					cansiton: !!item.cansiton,
					canlayon: !!item.canlayon,
					canstandon: !!item.canstandon,
				};
				const existing = map.get(cn);
				if (!existing) {
					map.set(cn, candidate);
					continue;
				}
				existing.cansiton = existing.cansiton || candidate.cansiton;
				existing.canlayon = existing.canlayon || candidate.canlayon;
				existing.canstandon = existing.canstandon || candidate.canstandon;
			}
		}
	} catch {
		// unreadable furnidata → interaction columns are skipped
	}
	return map;
}

async function main(): Promise<void> {
	const t0 = Date.now();
	const dir = resolve(DIR);
	const entries = new Set(readdirSync(dir));
	const infoCache = new Map<string, BundleInfo>();
	const flagsMap = WITH_INTERACTION
		? loadFurniFlags(resolve(FURNIDATA))
		: new Map<string, Flags>();

	const [rows] = (await db.execute(
		sql`SELECT item_name, public_name, width, length, stack_height, allow_stack,
		           allow_sit, allow_lay, allow_walk, interaction_type, interaction_modes_count
		    FROM items_base
		    WHERE type IN (${sql.join(
					TYPES.map((t) => sql`${t}`),
					sql`, `,
				)})`,
	)) as unknown as [Row[], unknown];

	console.log(
		`[stack-sql] ${rows.length} furniture rows | ${entries.size} bundles | ${flagsMap.size} furnidata flags`,
	);

	const updates: string[] = [];
	let matched = 0;
	let changed = 0;
	let resolvedBase = 0;
	const counts = {
		dims: 0,
		allowFlags: 0,
		modes: 0,
		interactionType: 0,
	};
	const missing: string[] = [];
	const unparsed: string[] = [];

	for (const row of rows) {
		const name = row.item_name;
		const base = name.includes("*") ? name.slice(0, name.indexOf("*")) : name;
		const variants = [name, name.trim(), base, base.trim()];

		let chosen: string | null = null;
		for (const variant of variants) {
			for (const ext of EXTENSIONS) {
				const candidate = `${variant}${ext}`;
				if (entries.has(candidate)) {
					chosen = candidate;
					break;
				}
			}
			if (chosen) break;
		}
		if (!chosen) {
			missing.push(name);
			continue;
		}
		if (!chosen.startsWith(`${name}.`)) resolvedBase++;

		let info = infoCache.get(chosen);
		if (!info) {
			info = readBundleInfo(resolve(dir, chosen));
			infoCache.set(chosen, info);
		}
		if (!info.dims) {
			unparsed.push(`${name} (${chosen})`);
			continue;
		}
		matched++;

		const width = Math.trunc(info.dims.x);
		const length = Math.trunc(info.dims.y);
		const stackHeight = Number(info.dims.z.toFixed(2));
		const allowStack = info.dims.z > 0;

		const setParts: string[] = [];
		const dimsChanged =
			row.width !== width ||
			row.length !== length ||
			Number(row.stack_height) !== stackHeight ||
			isTruthyBit(row.allow_stack) !== allowStack;
		if (dimsChanged) counts.dims++;
		setParts.push(
			`width=${width}`,
			`length=${length}`,
			`stack_height=${stackHeight}`,
			`allow_stack=${qbit(allowStack)}`,
		);

		// Interaction columns — only when the classname exists in furnidata
		// (mirrors the app sweep: authoritative flags, never keyword guesses).
		const flags =
			flagsMap.get(name) ??
			flagsMap.get(base) ??
			flagsMap.get(name.trim()) ??
			flagsMap.get(base.trim());
		if (WITH_INTERACTION && flags) {
			const auto = autoDetectInteraction(name, row.public_name || undefined, {
				cansiton: flags.cansiton,
				canlayon: flags.canlayon,
				canstandon: flags.canstandon,
				hasActionData: true,
				animationStates: info.animationStates,
				logicType: info.logicType,
			});

			if (
				Number(row.allow_sit) !== 2 &&
				isTruthyBit(row.allow_sit) !== auto.canSit
			) {
				setParts.push(`allow_sit=${qbit(auto.canSit)}`);
				counts.allowFlags++;
			}
			if (
				Number(row.allow_lay) !== 2 &&
				isTruthyBit(row.allow_lay) !== auto.canLay
			) {
				setParts.push(`allow_lay=${qbit(auto.canLay)}`);
				counts.allowFlags++;
			}
			if (
				Number(row.allow_walk) !== 2 &&
				isTruthyBit(row.allow_walk) !== auto.canStand
			) {
				setParts.push(`allow_walk=${qbit(auto.canStand)}`);
				counts.allowFlags++;
			}
			if (
				Number(row.interaction_modes_count ?? 0) !== auto.interactionModesCount
			) {
				setParts.push(`interaction_modes_count=${auto.interactionModesCount}`);
				counts.modes++;
			}
			if (
				(row.interaction_type === "default" || !row.interaction_type) &&
				auto.interactionType !== "default"
			) {
				setParts.push(`interaction_type=${q(auto.interactionType)}`);
				counts.interactionType++;
			}
		}

		const isChanged =
			dimsChanged ||
			setParts.some(
				(p) =>
					!p.startsWith("width=") &&
					!p.startsWith("length=") &&
					!p.startsWith("stack_height=") &&
					!p.startsWith("allow_stack="),
			);
		if (isChanged) changed++;
		if (!EMIT_ALL && !isChanged) continue;

		updates.push(
			`UPDATE items_base SET ${setParts.join(", ")} WHERE item_name=${q(name)} AND type IN (${TYPES.map(q).join(", ")});`,
		);
	}

	const header = [
		"-- Auto-generated by scripts/generate-stack-height-sql.ts",
		`-- Source bundles: ${dir}`,
		`-- Furnidata:      ${WITH_INTERACTION ? resolve(FURNIDATA) : "(disabled)"}`,
		`-- Generated: ${new Date().toISOString()}`,
		`-- Furniture rows: ${rows.length} | matched: ${matched} | changed: ${changed} | missing bundle: ${missing.length} | unparsable: ${unparsed.length}`,
		`-- Changes: dimensions ${counts.dims} | allow_sit/lay/walk ${counts.allowFlags} | modes_count ${counts.modes} | interaction_type ${counts.interactionType}`,
		`-- Mode: ${EMIT_ALL ? "all matched rows" : "changed rows only"}`,
		"",
		"START TRANSACTION;",
		"",
	].join("\n");
	const footer = "\n\nCOMMIT;\n";

	writeFileSync(
		resolve(OUT),
		`${header}${updates.join("\n")}${footer}`,
		"utf-8",
	);

	console.log(`[stack-sql] matched ${matched}, changed ${changed}`);
	console.log(
		`[stack-sql] changes -> dims ${counts.dims}, allow flags ${counts.allowFlags}, modes ${counts.modes}, interaction_type ${counts.interactionType}`,
	);
	if (resolvedBase > 0)
		console.log(`[stack-sql] resolved via base classname: ${resolvedBase}`);
	console.log(`[stack-sql] updates written: ${updates.length}`);
	if (missing.length) {
		console.log(
			`[stack-sql] no bundle (${missing.length}): ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? ", …" : ""}`,
		);
	}
	if (unparsed.length) {
		console.log(
			`[stack-sql] unparsable (${unparsed.length}): ${unparsed.slice(0, 20).join(", ")}${unparsed.length > 20 ? ", …" : ""}`,
		);
	}
	console.log(`[stack-sql] wrote ${resolve(OUT)} in ${Date.now() - t0}ms`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
