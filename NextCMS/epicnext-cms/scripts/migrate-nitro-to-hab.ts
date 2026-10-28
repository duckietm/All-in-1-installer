#!/usr/bin/env tsx
/**
 * Rename on-disk furniture bundles from `.nitro` to `.hab`.
 *
 * Imports have written `<classname>.hab` since the bundle-extension switch, but
 * everything already on disk kept its old name. That matters at runtime: the
 * client asks for `.hab`, so a catalogue whose assets are still `.nitro` shows
 * furniture that renders as nothing. This script closes that gap.
 *
 * It is deliberately conservative:
 *   - refuses to run without `--dry-run` or `--yes`;
 *   - never overwrites an existing `.hab` — a conflict is reported, not resolved;
 *   - never deletes anything, so a half-finished run is recoverable by hand;
 *   - idempotent: a second run over migrated dirs is a no-op.
 *
 * Run it in a maintenance window. The rename is per-file, so a client request
 * for a given `.nitro` 404s from the moment that file is renamed until the
 * client asks for `.hab`.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-nitro-to-hab.ts --dry-run
 *   pnpm tsx scripts/migrate-nitro-to-hab.ts --yes
 *   pnpm tsx scripts/migrate-nitro-to-hab.ts --yes --dir /var/www/extra/bundles
 *   pnpm tsx scripts/migrate-nitro-to-hab.ts --yes --skip-generic
 */

import "./load-env";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import {
	getFurniAssetWriteTargets,
	getGamedataRoot,
} from "@/lib/services/furni-asset-dirs";
import { getPublicAssetRoot } from "@/lib/services/public-asset-root";
import { siteSettings } from "@/lib/services/site-settings";
import { getRuntimePath } from "@/lib/utils/runtime-path";

const LEGACY_EXT = ".nitro";
const TARGET_EXT = ".hab";

interface Args {
	dryRun: boolean;
	yes: boolean;
	skipGeneric: boolean;
	dirs: string[];
}

function parseArgs(argv: string[]): Args {
	const dirs: string[] = [];
	let dryRun = false;
	let yes = false;
	let skipGeneric = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--dry-run") dryRun = true;
		else if (arg === "--yes" || arg === "-y") yes = true;
		else if (arg === "--skip-generic") skipGeneric = true;
		else if (arg === "--dir") {
			const value = argv[++i];
			if (!value) throw Error("--dir needs a path");
			dirs.push(path.resolve(value));
		} else throw Error(`Unknown argument: ${arg}`);
	}
	return { dryRun, yes, skipGeneric, dirs };
}

/**
 * Where the app keeps bundles. Mirrors the resolution in figure-import.ts /
 * effect-import.ts / pet-import.ts so the script follows the same site settings
 * the running instance uses. Settings are best-effort: a database that is down
 * must not stop an operator from migrating files, so failures fall back to the
 * on-disk defaults rather than aborting.
 */
async function resolveDirs(skipGeneric: boolean): Promise<string[]> {
	const found: string[] = [];
	const push = (dir: string | null | undefined) => {
		if (dir?.trim()) found.push(path.resolve(dir.trim()));
	};

	// Furniture: primary + every configured mirror (gamedata, nitro-files).
	try {
		const targets = await getFurniAssetWriteTargets();
		push(targets.nitroDir);
		for (const mirror of targets.mirrorDirs) push(mirror.nitroDir);
	} catch (error) {
		console.warn(
			`  ! could not read furniture asset settings (${(error as Error).message}); using defaults`,
		);
		push(
			getRuntimePath(process.cwd(), "public/nitro-assets/bundled/furniture"),
		);
		push("/var/www/gamedata/bundled/furniture");
	}

	let gamedataRoot = "";
	try {
		gamedataRoot = await getGamedataRoot();
	} catch {
		/* defaults below cover it */
	}

	for (const type of ["figure", "effect"]) {
		let configured = "";
		try {
			configured = (
				(await siteSettings.get(`${type}_nitro_dir`, "")) ?? ""
			).trim();
		} catch {
			/* fall through to defaults */
		}
		if (configured) push(configured);
		else if (gamedataRoot)
			push(getRuntimePath(gamedataRoot, `bundled/${type}`));
		else
			push(
				getRuntimePath(
					getPublicAssetRoot(),
					`public/nitro-assets/bundled/${type}`,
				),
			);
	}

	// Pets: the CMS dir is `pet`, this deployment's gamedata dir is `pets`.
	// Both spellings are listed so neither is silently skipped.
	push(getRuntimePath(getPublicAssetRoot(), "public/nitro-assets/bundled/pet"));
	if (gamedataRoot) {
		push(getRuntimePath(gamedataRoot, "bundled/pet"));
		push(getRuntimePath(gamedataRoot, "bundled/pets"));
	}

	// `generic` holds the stock client UI bundles (selection_arrow, room,
	// tile_cursor, place_holder…) that this CMS never imported. They are included
	// by default because the renderer's `generic.asset.url` template resolves to
	// `.hab` too — leaving them behind breaks the room view, not just furniture.
	if (!skipGeneric && gamedataRoot) {
		push(getRuntimePath(gamedataRoot, "bundled/generic"));
	}

	return [...new Set(found)];
}

interface DirResult {
	dir: string;
	renamed: number;
	alreadyHab: number;
	conflicts: Array<{ from: string; to: string }>;
	errors: Array<{ file: string; message: string }>;
}

async function migrateDir(dir: string, dryRun: boolean): Promise<DirResult> {
	const result: DirResult = {
		dir,
		renamed: 0,
		alreadyHab: 0,
		conflicts: [],
		errors: [],
	};

	let entries: string[];
	try {
		entries = await fs.readdir(dir);
	} catch (error) {
		result.errors.push({ file: dir, message: (error as Error).message });
		return result;
	}

	for (const entry of entries) {
		if (!entry.toLowerCase().endsWith(LEGACY_EXT)) continue;
		const from = path.join(dir, entry);
		const to = path.join(
			dir,
			`${entry.slice(0, -LEGACY_EXT.length)}${TARGET_EXT}`,
		);

		// Never clobber. A pre-existing `.hab` is a live bundle the client is
		// already serving; leaving the `.nitro` alone is the only safe answer.
		if (existsSync(to)) {
			result.conflicts.push({
				from: path.basename(from),
				to: path.basename(to),
			});
			continue;
		}

		if (dryRun) {
			result.renamed++;
			continue;
		}
		try {
			await fs.rename(from, to);
			result.renamed++;
		} catch (error) {
			result.errors.push({ file: entry, message: (error as Error).message });
		}
	}

	// Report the target state too, so a run confirms the end condition rather
	// than just the work it did.
	for (const entry of await fs.readdir(dir)) {
		if (entry.toLowerCase().endsWith(TARGET_EXT)) result.alreadyHab++;
	}

	return result;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));

	if (!args.dryRun && !args.yes) {
		console.error(
			"Nothing to do: pass --dry-run to preview, or --yes to rename for real.",
		);
		process.exitCode = 2;
	}

	const dirs = [
		...new Set([...args.dirs, ...(await resolveDirs(args.skipGeneric))]),
	];
	const existing = dirs.filter((dir) => existsSync(dir));

	console.log(
		args.dryRun
			? "DRY RUN — no files will be touched."
			: "Renaming .nitro bundles to .hab.",
	);
	if (!args.dryRun) {
		console.log(
			"Run this in a maintenance window: the client 404s on each file between its rename and its switch to .hab.",
		);
	}
	console.log(`\nDirectories (${existing.length} of ${dirs.length} exist):`);
	for (const dir of existing) console.log(`  ${dir}`);
	const missing = dirs.filter((dir) => !existsSync(dir));
	if (missing.length) {
		console.log(`\nNot present, skipped:`);
		for (const dir of missing) console.log(`  ${dir}`);
	}
	if (!existing.length) {
		console.log("\nNo bundle directories found — nothing to migrate.");
		return;
	}

	console.log("");
	const results: DirResult[] = [];
	for (const dir of existing) {
		results.push(await migrateDir(dir, args.dryRun));
	}

	let totalRenamed = 0;
	let totalHab = 0;
	let totalConflicts = 0;
	let totalErrors = 0;
	for (const result of results) {
		totalRenamed += result.renamed;
		totalHab += result.alreadyHab;
		totalConflicts += result.conflicts.length;
		totalErrors += result.errors.length;
		console.log(
			`${result.dir}\n` +
				`    ${args.dryRun ? "would rename" : "renamed"}: ${result.renamed}\n` +
				`    .hab present:   ${result.alreadyHab}`,
		);
		for (const conflict of result.conflicts) {
			console.log(
				`    CONFLICT: ${conflict.from} — ${conflict.to} already exists`,
			);
		}
		for (const error of result.errors) {
			console.log(`    ERROR: ${error.file} — ${error.message}`);
		}
	}

	console.log(
		`\n${args.dryRun ? "Would rename" : "Renamed"} ${totalRenamed} file(s). ` +
			`${totalHab} .hab bundle(s) present afterwards.`,
	);
	if (totalConflicts) {
		console.log(
			`\n${totalConflicts} conflict(s): a .hab with that name already exists. ` +
				"The .nitro was left in place. Resolve these by hand — the client can only load one of the two.",
		);
	}
	if (totalErrors)
		console.log(`\n${totalErrors} error(s); re-run once they are fixed.`);

	// Non-zero on a partial migration so a wrapper cannot report success.
	if (totalConflicts || totalErrors) process.exitCode = 1;
}

// The settings lookups open a mysql2 pool, which keeps the event loop alive —
// the script prints its whole report and then sits there burning a timeout
// instead of exiting. Closing the pool is not enough on its own here, so the
// exit is explicit, matching scripts/furni-diagnose-now.ts.
main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.then(async () => {
		await db.$client.end().catch(() => {});
		process.exit(process.exitCode ?? 0);
	});
