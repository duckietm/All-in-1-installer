// Command-line driver for the catalog audit/repair pipeline.
//
// The same engine the admin "Catalog audit" UI streams from (`runCatalogAudit`),
// for the terminal: audit the hotel catalog against one or more clone sources
// (Habbo and the retros), fix the furniture that is broken, and bring missing
// items into the catalog — optionally writing and applying the catalog SQL.
//
// Usage:
//   pnpm catalog:sync                        # interactive menu (scripts/catalog-sync.sh)
//   pnpm exec tsx scripts/catalog-sync.ts --list-sources
//   pnpm exec tsx scripts/catalog-sync.ts --sources="Habbo (COM)"    # audit only
//   pnpm exec tsx scripts/catalog-sync.ts --all --sources=default-habbo-com
//   pnpm exec tsx scripts/catalog-sync.ts --all --sql --apply-sql   # + write/apply SQL
//
// Flags:
//   --list-sources     print the configured clone sources and exit
//   --tsv              with the above, print `id\tname\tfurnidataUrl` rows
//   --sources=<a,b>    compare against these sources (id or name, comma-separated)
//   --icons            re-download missing furniture icons from the sources
//   --nitros           re-download missing .nitro / swf bundles (stored as .hab)
//   --furnidata        repair FurnitureData.json (add missing, drop duplicates)
//   --structure        repair orphaned / duplicate catalog rows
//   --check-ids        check FurnitureData.json for spriteId conflicts
//   --sql              generate the catalog SQL for items missing an offer
//   --apply-sql        apply the generated SQL (implies --sql)
//   --organize-sql     order the generated SQL by catalog page (implies --sql)
//   --all              --icons --nitros --furnidata --structure --check-ids
//   --import-new       import furniture the source has and this hotel lacks
//   --only=<a,b>       restrict the import to these classnames
//   --limit=N          stop the import after N items
//   --concurrency=N    parallel imports (default 3)
//   --reconcile        align FurnitureData.json with items_base after importing
//   --fix-sprite-ids   correct items_base.sprite_id drift
//   --rebuild-offers   rebuild catalog offer_id mirrors
//   --align-ids        move items_base ids onto their furnidata ids (report;
//                      add --apply to let the script execute it)
//   --rename-bundles   rename legacy .nitro bundles to .hab (report; --apply runs it)
//   --json             print one machine-readable JSON report
//   --dry-run          with --import-new: list what would be imported, import nothing
//   --fail-on-errors   exit 3 when error-severity issues remain
//
// Audit is read-only by default: nothing is written until one of the repair
// flags is passed. One nuance: generating the catalog SQL also creates the
// `catalog_pages` category sub-pages it references (exactly like the app's own
// import does) — only the `catalog_items` rows wait for `--apply-sql`. Use
// `--organize-sql` to also emit those page INSERTs into the .sql file.

import "./load-env";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LOCAL_BUNDLE_EXT } from "@/lib/furni/classname";
import type { AuditEvent, AuditSummary } from "@/lib/services/catalog-audit";
import type { SourceFurni } from "@/lib/services/clone-import";
import type { CloneSource } from "@/lib/services/clone-sources";

/** Where generated catalog SQL is written (`storage/` is gitignored). */
function sqlOutputDir(): string {
	return join(process.cwd(), "storage", "catalog-sync");
}

export type SourceRef = CloneSource;

export type AuditIssue = NonNullable<AuditEvent["issues"]>[number];
export type MissingFromSource = NonNullable<
	AuditEvent["missingFromSources"]
>[number];

export interface AuditReport {
	sources: SourceRef[];
	summary?: AuditSummary;
	issues: AuditIssue[];
	missingFromSources: MissingFromSource[];
	sqlFile?: string;
	imported?: ImportOutcome;
}

export interface ImportOutcome {
	source: string;
	candidates: number;
	imported: number;
	skipped: number;
	failed: number;
	failures: Array<{ classname: string; error: string }>;
	/** Sources that were skipped because they cannot serve bundles. */
	skippedSources: string[];
}

/**
 * Whether a source can actually be imported from.
 *
 * The clone import downloads `${nitroBaseUrl}/${classname}.nitro` and gives up
 * when that is not reachable. Habbo's own entries carry no nitro/icon base URLs
 * (their furnidata is served, their assets are not), so they are compare-only:
 * perfect for finding out what this hotel lacks, useless for actually fetching
 * it. The SWF-based path that works against `images.habbo.com` lives in
 * `furni-import.ts`, not in the clone importer this CLI uses.
 */
export function canImportBundles(source: SourceRef): boolean {
	return Boolean(source.nitroBaseUrl?.trim());
}

export interface CatalogSyncFlags {
	listSources: boolean;
	tsv: boolean;
	sourceIds: string[];
	repairIcons: boolean;
	repairNitros: boolean;
	repairFurniData: boolean;
	repairStructure: boolean;
	checkFurniDataIds: boolean;
	generateSql: boolean;
	applySql: boolean;
	organizeSql: boolean;
	json: boolean;
	failOnErrors: boolean;
	importNew: boolean;
	dryRun: boolean;
	importLimit: number;
	importConcurrency: number;
	importOnly: string[];
	reconcile: boolean;
	fixSpriteIds: boolean;
	rebuildOffers: boolean;
	alignIds: boolean;
	renameBundles: boolean;
	apply: boolean;
}

export const DEFAULT_CATALOG_SYNC_FLAGS: Omit<CatalogSyncFlags, "sourceIds"> = {
	listSources: false,
	tsv: false,
	repairIcons: false,
	repairNitros: false,
	repairFurniData: false,
	repairStructure: false,
	checkFurniDataIds: false,
	generateSql: false,
	applySql: false,
	organizeSql: false,
	json: false,
	failOnErrors: false,
	importNew: false,
	dryRun: false,
	importLimit: 0,
	importConcurrency: 3,
	importOnly: [],
	reconcile: false,
	fixSpriteIds: false,
	rebuildOffers: false,
	alignIds: false,
	renameBundles: false,
	apply: false,
};

const BOOLEAN_FLAGS: Record<string, keyof CatalogSyncFlags> = {
	"--list-sources": "listSources",
	"--tsv": "tsv",
	"--icons": "repairIcons",
	"--repair-icons": "repairIcons",
	"--nitros": "repairNitros",
	"--repair-nitros": "repairNitros",
	"--furnidata": "repairFurniData",
	"--repair-furnidata": "repairFurniData",
	"--structure": "repairStructure",
	"--repair-structure": "repairStructure",
	"--check-ids": "checkFurniDataIds",
	"--sql": "generateSql",
	"--apply-sql": "applySql",
	"--organize-sql": "organizeSql",
	"--json": "json",
	"--fail-on-errors": "failOnErrors",
	"--import-new": "importNew",
	"--dry-run": "dryRun",
	"--reconcile": "reconcile",
	"--fix-sprite-ids": "fixSpriteIds",
	"--rebuild-offers": "rebuildOffers",
	"--align-ids": "alignIds",
	"--rename-bundles": "renameBundles",
	// Authorises the two heavyweight child steps that rewrite stored data.
	"--apply": "apply",
};

const NUMBER_FLAGS: Record<string, keyof CatalogSyncFlags> = {
	"--limit": "importLimit",
	"--concurrency": "importConcurrency",
};

const LIST_FLAGS: Record<string, keyof CatalogSyncFlags> = {
	"--only": "importOnly",
};

export function parseCatalogSyncArgs(raw: string[]): CatalogSyncFlags {
	const flags: CatalogSyncFlags = {
		...DEFAULT_CATALOG_SYNC_FLAGS,
		sourceIds: [],
	};

	for (const arg of raw) {
		if (arg === "--") continue;

		if (arg === "--all") {
			flags.repairIcons = true;
			flags.repairNitros = true;
			flags.repairFurniData = true;
			flags.repairStructure = true;
			flags.checkFurniDataIds = true;
			continue;
		}

		if (arg === "--everything") {
			flags.repairIcons = true;
			flags.repairNitros = true;
			flags.repairFurniData = true;
			flags.repairStructure = true;
			flags.checkFurniDataIds = true;
			flags.importNew = true;
			flags.reconcile = true;
			flags.fixSpriteIds = true;
			flags.rebuildOffers = true;
			continue;
		}

		const separator = arg.indexOf("=");
		const name = separator >= 0 ? arg.slice(0, separator) : arg;

		const booleanFlag = BOOLEAN_FLAGS[name];
		if (booleanFlag) {
			flags[booleanFlag] = true as never;
			continue;
		}

		if (name === "--sources" || name === "--source") {
			if (separator < 0)
				throw new Error(
					`${name} needs a value, e.g. --sources=default-habbo-com`,
				);
			const value = arg.slice(separator + 1);
			for (const part of value
				.split(",")
				.map((entry) => entry.trim())
				.filter(Boolean))
				flags.sourceIds.push(part);
			continue;
		}

		if (NUMBER_FLAGS[name]) {
			if (separator < 0)
				throw new Error(`${name} needs a value, e.g. ${name}=10`);
			const parsed = Number(arg.slice(separator + 1));
			if (!Number.isInteger(parsed) || parsed < 0)
				throw new Error(`${name} needs a non-negative integer`);
			flags[NUMBER_FLAGS[name]] = parsed as never;
			continue;
		}

		if (LIST_FLAGS[name]) {
			if (separator < 0)
				throw new Error(`${name} needs a value, e.g. ${name}=chair,table`);
			const value = arg.slice(separator + 1);
			for (const part of value
				.split(",")
				.map((entry) => entry.trim())
				.filter(Boolean))
				flags.importOnly.push(part);
			continue;
		}

		throw new Error(
			`Unknown flag: ${arg} (run with --help for the supported flags)`,
		);
	}

	// Applying SQL implies generating it, and organising it implies generating.
	if (flags.applySql) flags.generateSql = true;
	if (flags.organizeSql) flags.generateSql = true;

	// A dry run without an import step has nothing to preview.
	if (flags.dryRun && !flags.importNew)
		throw new Error("--dry-run only makes sense together with --import-new");

	if (flags.importNew && flags.applySql) {
		// Both write; that is allowed but it is worth making the operator think.
		logNote?.("--import-new and --apply-sql will both write to the catalog");
	}
	return flags;
}

let logNote: ((line: string) => void) | undefined;

/**
 * Pick the furniture to import from a source's furnidata.
 *
 * Pure so the filtering rules (skip what we already have, `--only` filter,
 * `--limit` cap) can be tested without a database.
 */
export function selectImportCandidates(
	entries: SourceFurni[],
	present: Set<string>,
	options: { only?: string[]; limit?: number } = {},
): SourceFurni[] {
	const normalize = (value: string) => value.trim().toLowerCase();
	const only = options.only?.length
		? new Set(options.only.map(normalize))
		: null;

	const candidates = entries.filter((entry) => {
		if (!entry.classname) return false;
		if (present.has(normalize(entry.classname))) return false;
		if (only && !only.has(normalize(entry.classname))) return false;
		return true;
	});

	const limit = options.limit ?? 0;
	return limit > 0 ? candidates.slice(0, limit) : candidates;
}

/** Human-readable list of what the run will do. */
export function describeActions(flags: CatalogSyncFlags): string {
	const actions = ["audit"];
	if (flags.repairIcons) actions.push("icons");
	if (flags.repairNitros) actions.push("nitros");
	if (flags.repairFurniData) actions.push("furnidata");
	if (flags.repairStructure) actions.push("structure");
	if (flags.checkFurniDataIds) actions.push("id-check");
	if (flags.importNew) actions.push(flags.dryRun ? "import (dry)" : "import");
	if (flags.reconcile) actions.push("reconcile");
	if (flags.fixSpriteIds) actions.push("sprite-ids");
	if (flags.rebuildOffers) actions.push("offers");
	if (flags.alignIds) actions.push(`align-ids${flags.apply ? "=apply" : ""}`);
	if (flags.renameBundles)
		actions.push(`rename${flags.apply ? "=apply" : "-dry"}-bundles`);
	if (flags.applySql) actions.push("apply-sql");
	else if (flags.generateSql) actions.push("generate-sql");
	if (flags.organizeSql) actions.push("organised");
	return actions.join(" + ");
}

/** True when the file is being executed, not imported by a test. */
function isEntryPoint(): boolean {
	const entry = process.argv[1];
	return (
		Boolean(entry) && import.meta.url === pathToFileURL(String(entry)).href
	);
}

async function loadSourceCatalogue(): Promise<SourceRef[]> {
	const { listSources } = await import("@/lib/services/clone-sources");
	const sources = await listSources();
	// Full source objects: the import step needs the icon/nitro base URLs too.
	return sources.filter((source) => source.furnidataUrl);
}

async function commandListSources(flags: CatalogSyncFlags): Promise<number> {
	const sources = await loadSourceCatalogue();

	if (flags.tsv) {
		for (const source of sources)
			console.log([source.id, source.name, source.furnidataUrl].join("\t"));
		return 0;
	}

	console.log(`Configured clone sources (${sources.length}):`);
	for (const source of sources)
		console.log(`  ${source.id}\t${source.name}\t${source.furnidataUrl}`);
	console.log(
		"\nCompare with: --sources=<id> (comma-separated; display names work too)",
	);
	return 0;
}

/** Persist the generated SQL so it can be reviewed or replayed by hand. */
export async function writeGeneratedSql(sql: string): Promise<string> {
	await mkdir(sqlOutputDir(), { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const file = join(sqlOutputDir(), `catalog-${stamp}.sql`);
	await writeFile(file, sql.endsWith("\n") ? sql : `${sql}\n`, "utf8");
	return file.replace(`${process.cwd()}/`, "");
}

/**
 * Run one of the repo's existing standalone maintenance scripts as a child
 * process, with the same Node conditions this CLI needs.
 */
function runChildScript(
	script: string,
	args: string[],
	log: (line: string) => void,
): number {
	const nodeArgs = [
		"--conditions=react-server",
		"--import",
		"tsx",
		script,
		...args,
	];
	log(`· running scripts/${script} ${args.join(" ")}`.trimEnd());
	const result = spawnSync(process.execPath, nodeArgs, {
		cwd: process.cwd(),
		stdio: "inherit",
		env: process.env,
	});
	if (result.error) {
		console.error(`! ${script} failed to start: ${result.error.message}`);
		return 1;
	}
	return result.status ?? 1;
}

/**
 * Import furniture that exists at the compared source but not in this hotel.
 *
 * `cloneSingleFurni` downloads the bundle + icon, stores the bundle as
 * `LOCAL_BUNDLE_EXT`, appends the furnidata entry and creates the catalog page
 * plus the offer itself — so an import is not usable for furniture you want to
 * keep out of the catalog.
 */
async function stepImportNew(
	flags: CatalogSyncFlags,
	sources: SourceRef[],
	log: (line: string) => void,
): Promise<ImportOutcome | undefined> {
	const { getClonableClassnames, fetchSourceFurnidata } = await import(
		"@/lib/services/clone-import"
	);
	const { cloneSingleFurni } = await import("@/lib/services/clone-import");

	let planned = 0;
	let imported = 0;
	let skipped = 0;
	let failed = 0;
	const failures: Array<{ classname: string; error: string }> = [];
	const deferredEntries: Array<{
		entry: Record<string, unknown>;
		itemType: string;
	}> = [];
	let lastSource = "";
	const skippedSources: string[] = [];

	for (const source of sources) {
		if (!canImportBundles(source)) {
			log(
				`! ${source.name} serves no .nitro bundles — it can be compared against, but nothing can be imported from it`,
			);
			skippedSources.push(source.name);
			continue;
		}
		if (flags.importLimit > 0 && planned >= flags.importLimit) break;
		const remaining = flags.importLimit
			? flags.importLimit - planned
			: Number.POSITIVE_INFINITY;

		log(`· listing furniture missing at ${source.name}…`);
		const clonable = new Set(await getClonableClassnames(source));
		const entries = await fetchSourceFurnidata(source.furnidataUrl);
		const candidates = selectImportCandidates(entries, clonable, {
			only: flags.importOnly,
			limit: Number.isFinite(remaining) ? remaining : 0,
		});
		if (candidates.length === 0) {
			log(`  nothing new to import from ${source.name}`);
			continue;
		}
		lastSource = source.name;

		if (flags.dryRun) {
			log(
				`  ${candidates.length} would be imported from ${source.name}${flags.importOnly.length ? " (filtered by --only)" : ""}`,
			);
			for (const entry of candidates.slice(0, 20))
				log(`    ${entry.classname} — ${entry.name}`);
			if (candidates.length > 20)
				log(`    … and ${candidates.length - 20} more`);
			planned += candidates.length;
			continue;
		}

		planned += candidates.length;
		const started = Date.now();
		let done = 0;
		let index = 0;

		const worker = async () => {
			while (index < candidates.length) {
				const entry = candidates[index++];
				const result = await cloneSingleFurni({
					source,
					entry,
					deferFurniData: true,
				});
				done += 1;
				if (result.ok) imported += 1;
				else if (result.skipped) skipped += 1;
				else {
					failed += 1;
					failures.push({
						classname: entry.classname,
						error: result.error ?? "unknown error",
					});
				}
				if (result.furniDataEntry)
					deferredEntries.push(
						result.furniDataEntry as {
							entry: Record<string, unknown>;
							itemType: string;
						},
					);

				if (done % 10 === 0 || done === candidates.length) {
					const rate = Math.max(done / ((Date.now() - started) / 1000), 1);
					const etaMin = Math.round((candidates.length - done) / rate / 60);
					log(
						`  ${source.name}: ${done}/${candidates.length} ${rate.toFixed(1)}/s, ETA ~${etaMin}m`,
					);
				}
			}
		};

		const workers = Math.max(
			1,
			Math.min(flags.importConcurrency, candidates.length),
		);
		await Promise.all(Array.from({ length: workers }, worker));
	}

	if (!flags.dryRun && deferredEntries.length > 0) {
		const { appendFurniEntriesBulk } = await import(
			"@/lib/services/furni-data"
		);
		await appendFurniEntriesBulk(deferredEntries);
		log(`· FurnitureData.json: +${deferredEntries.length} entries (one write)`);
	}

	return {
		source: lastSource,
		candidates: planned,
		imported,
		skipped,
		failed,
		failures: failures.slice(0, 25),
		skippedSources,
	};
}

/** Keep FurnitureData.json consistent with items_base after the import. */
async function stepReconcile(log: (line: string) => void): Promise<void> {
	const { reconcileFurniDataWithItemsBase } = await import(
		"@/lib/services/furni-data"
	);
	const result = await reconcileFurniDataWithItemsBase();
	log(
		`· reconcile: ${result.fixedIds} sprite id(s), ${result.fixedOfferIds} offer id(s), ${result.normalizedIds} normalised, ${result.fixedConflicts} conflict(s) resolved, ${result.missing} still missing`,
	);
}

/** items_base.sprite_id must equal its id wherever furnidata carries the item. */
async function stepFixSpriteIds(log: (line: string) => void): Promise<void> {
	const { verifyAndFixSpriteIds } = await import("@/lib/services/furni-data");
	const result = await verifyAndFixSpriteIds();
	log(`· sprite ids: ${result.checked} checked, ${result.fixed} corrected`);
}

/** offer_id mirrors the row id, never a literal -1. */
async function stepRebuildOffers(log: (line: string) => void): Promise<void> {
	const { rebuildCatalogOfferIds } = await import("@/lib/services/furni-data");
	const result = await rebuildCatalogOfferIds();
	log(`· offer ids: ${JSON.stringify(result)}`);
}

export async function commandRun(flags: CatalogSyncFlags): Promise<number> {
	const catalogue = await loadSourceCatalogue();

	// Resolve the selection up-front so a typo fails before anything is written.
	const known = new Set<string>();
	for (const source of catalogue) {
		known.add(source.id);
		known.add(source.name);
	}
	const unknown = flags.sourceIds.filter((id) => !known.has(id));
	if (unknown.length > 0) {
		console.error(
			`Unknown source: ${unknown.join(", ")}\nRun --list-sources to see the configured sites.`,
		);
		return 1;
	}

	const selected = flags.sourceIds.length
		? catalogue.filter(
				(source) =>
					flags.sourceIds.includes(source.id) ||
					flags.sourceIds.includes(source.name),
			)
		: catalogue;

	const { runCatalogAudit } = await import("@/lib/services/catalog-audit");

	const report: AuditReport = {
		sources: selected,
		issues: [],
		missingFromSources: [],
	};
	const quiet = flags.json;
	const log = (line: string) => {
		if (!quiet) console.log(line);
	};
	const started = Date.now();
	let pendingSql: string | undefined;

	log(
		`Catalog sync — ${selected.length} source(s), ${describeActions(flags)} — bundles stored as ${LOCAL_BUNDLE_EXT} (FURNI_BUNDLE_EXT)` +
			(flags.applySql ? "  [SQL WILL BE APPLIED]" : ""),
	);

	// 1) Move items_base ids onto their furnidata ids before anything else, so
	//    every later step sees stable ids. The script only reports without
	//    `--apply`.
	if (flags.alignIds) {
		runChildScript(
			"scripts/align-db-ids-with-furnidata.ts",
			flags.apply ? ["--apply"] : [],
			log,
		);
	}

	// 2) Audit + repair of what is already here.

	await runCatalogAudit(
		(event) => {
			switch (event.type) {
				case "progress":
					log(`· ${event.message ?? ""}`);
					break;
				case "items_loaded":
					log(`· items_base: ${event.total} rows`);
					break;
				case "catalog_loaded":
					log(`· catalog_items: ${event.total} rows`);
					break;
				case "sql_ready":
					log(`· catalog SQL generated: ${event.sqlCount ?? 0} statement(s)`);
					pendingSql = event.sql;
					break;
				case "sql_applied":
					log(
						`· catalog SQL applied: ${event.applied ?? 0} (failed ${event.sqlFailed ?? 0})`,
					);
					break;
				case "furnidata_repair_complete":
					log(
						`· FurnitureData.json: +${event.furniData?.added ?? 0} entries, ${event.furniData?.removedDuplicates ?? 0} duplicate(s) removed`,
					);
					break;
				case "structure_repair_complete":
					log(
						`· structure: ${event.structure?.orphanedRemoved ?? 0} orphaned removed, ${event.structure?.duplicatesMerged ?? 0} duplicate(s) merged, ${event.structure?.remappedReferences ?? 0} reference(s) remapped`,
					);
					break;
				case "repair_complete":
					log(
						`· asset repair: ${event.repair?.succeeded ?? 0} ok, ${event.repair?.failed ?? 0} failed, ${event.repair?.skipped ?? 0} skipped`,
					);
					break;
				case "batch_complete":
					report.issues = event.issues ?? [];
					report.missingFromSources = event.missingFromSources ?? [];
					report.summary = event.summary;
					break;
				case "error":
					console.error(`! ${event.message ?? "audit error"}`);
					break;
				default:
					break;
			}
		},
		{
			sourceIds: flags.sourceIds,
			repair: flags.repairIcons,
			repairNitros: flags.repairNitros,
			sql: flags.generateSql,
			applySql: flags.applySql,
			organizeSql: flags.organizeSql,
			repairFurniData: flags.repairFurniData,
			repairStructure: flags.repairStructure,
			checkFurniDataIds: flags.checkFurniDataIds,
		},
	);

	if (pendingSql?.trim()) report.sqlFile = await writeGeneratedSql(pendingSql);

	// 3) Import what the source has and this hotel does not.
	if (flags.importNew) {
		if (selected.length === 0) log("· no source selected, nothing to import");
		else report.imported = await stepImportNew(flags, selected, log);
	}

	// 4) Post-import consistency, then the legacy bundle rename.
	if (flags.reconcile) await stepReconcile(log);
	if (flags.fixSpriteIds) await stepFixSpriteIds(log);
	if (flags.rebuildOffers) await stepRebuildOffers(log);
	if (flags.renameBundles) {
		runChildScript(
			"scripts/migrate-nitro-to-hab.ts",
			flags.apply ? ["--yes"] : ["--dry-run"],
			log,
		);
	}

	if (flags.json) {
		console.log(
			JSON.stringify(
				{ flags, elapsedMs: Date.now() - started, ...report },
				null,
				2,
			),
		);
	} else {
		printSummary(report, started);
		if (report.sqlFile) console.log(`Catalog SQL: ${report.sqlFile}`);
	}

	const errors = report.issues.filter((issue) => issue.severity === "error");
	if (flags.failOnErrors && errors.length > 0) {
		if (!quiet) console.error(`${errors.length} error(s) remain unresolved.`);
		return 3;
	}
	return 0;
}

function printSummary(report: AuditReport, started: number): void {
	const summary = report.summary;
	const seconds = ((Date.now() - started) / 1000).toFixed(1);

	console.log(`\nDone in ${seconds}s`);
	if (!summary) {
		console.log("No summary was produced (the audit stopped early).");
		return;
	}

	console.log(`  items_base             ${summary.totalItemsBase}`);
	console.log(`  catalog_items          ${summary.totalCatalogItems}`);
	console.log(`  missing catalog entry  ${summary.missingCatalog}`);
	console.log(`  orphaned catalog rows  ${summary.orphanedCatalog}`);
	console.log(`  duplicate classnames   ${summary.duplicates}`);
	console.log(
		`  missing icons          ${summary.missingIcon} (repaired ${summary.iconsRepaired}, still missing ${summary.iconsStillMissing})`,
	);
	console.log(
		`  missing nitro bundles  ${summary.missingNitro} (repaired ${summary.nitrosRepaired}, still missing ${summary.nitrosStillMissing})`,
	);
	console.log(
		`  catalog SQL            ${summary.catalogSqlCount} stmt, applied ${summary.catalogSqlApplied}`,
	);
	console.log(`  furnidata added        ${summary.furniDataAdded}`);
	console.log(
		`  not restorable         ${summary.unrepairableCount} (no icon/bundle on any compared source)`,
	);

	if (report.imported) {
		const outcome = report.imported;
		console.log(
			`  imported from source   ${outcome.imported} new (${outcome.skipped} already present, ${outcome.failed} failed)`,
		);
		if (outcome.skippedSources.length > 0)
			console.log(
				`  compared only          ${outcome.skippedSources.join(", ")} (no .nitro bundles to import from)`,
			);
		for (const failure of outcome.failures)
			console.log(`    ${failure.classname}: ${failure.error}`);
	}

	if (report.missingFromSources.length > 0) {
		const bySource = new Map<string, number>();
		for (const entry of report.missingFromSources)
			bySource.set(entry.sourceName, (bySource.get(entry.sourceName) ?? 0) + 1);
		console.log(
			`\n  on compared sources but not in this hotel: ${report.missingFromSources.length}`,
		);
		for (const [name, count] of bySource)
			console.log(`    ${name.padEnd(24)} ${count}`);
	}

	const errors = report.issues.filter((issue) => issue.severity === "error");
	if (errors.length > 0) {
		console.log(`\n  unresolved errors: ${errors.length}`);
		for (const issue of errors.slice(0, 20))
			console.log(`    ${issue.classname ?? issue.type}: ${issue.message}`);
		if (errors.length > 20) console.log(`    … and ${errors.length - 20} more`);
	}
}

async function main(): Promise<number> {
	const flags = parseCatalogSyncArgs(process.argv.slice(2));
	try {
		if (flags.listSources) return await commandListSources(flags);
		return await commandRun(flags);
	} catch (error) {
		console.error(
			`Catalog sync failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		return 1;
	}
}

if (isEntryPoint()) {
	main().then(
		(code) => {
			process.exit(code);
		},
		(error) => {
			console.error(error);
			process.exit(1);
		},
	);
}
