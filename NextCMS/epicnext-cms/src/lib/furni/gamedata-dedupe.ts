import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { bundleExistsInDirs } from "@/lib/furni/bundle-file";
import { getFigureDataPath, readFigureData } from "@/lib/services/figuredata";
import {
	getFigureMapPath,
	listFigureLibraries,
} from "@/lib/services/figuremap";
import { getFurniAssetWriteTargets } from "@/lib/services/furni-asset-dirs";
import {
	getFurnitureDataWritePaths,
	readFurniData,
	withFurniDataLock,
	writeFurniData,
} from "@/lib/services/furni-data";
import {
	readGamedataJson,
	withGamedataLock,
	writeGamedataJsonAtomic,
} from "@/lib/services/import/core/gamedata-json";

/**
 * Dedupe and orphan-cleaning for the gamedata JSON files.
 *
 * These files drift apart over time. A failed import leaves a FurnitureData
 * entry without its `.nitro`, so the client renders nothing for that item and
 * a clean re-import of the classname is blocked. A half-finished figure
 * import leaves a FigureMap part pointing at a set that never made it into
 * FigureData. Re-importing the same furniture appends a second entry with an
 * identical classname.
 *
 * The figure passes are independent of the furniture ones, but they are
 * order-dependent: `cleanFigureMap` must run before `cleanFigureData`,
 * because removing a dangling part is exactly what makes a set in FigureData
 * become unreferenced. Running it the other way round deletes a set that the
 * map still names.
 *
 * Every operation here is deliberately conservative:
 * - only an exact `classname` collision counts as a duplicate, never a fuzzy
 *   match, and only within a single section;
 * - the survivor is the entry with the highest `revision`, i.e. the freshest
 *   import. Two rows with one classname also point at one bundle, so bundle
 *   presence cannot pick between them; it is reported per classname instead;
 * - only orphans are removed. A row is never dropped for having empty or odd
 *   fields, because that is a content decision rather than a cleanup one;
 * - a classname present in both `roomitemtypes` and `wallitemtypes` is
 *   reported but never auto-removed, since that would change an item's type.
 */

export const FURNITYPE_SECTIONS = ["roomitemtypes", "wallitemtypes"] as const;
export type FurnitypeSection = (typeof FURNITYPE_SECTIONS)[number];

interface FurniEntryLike {
	classname?: unknown;
	[key: string]: unknown;
}
/**
 * FurnitureData as this module sees it: an open record of `furnitype`
 * sections. Every other key is preserved untouched, so a write never invents
 * or drops a section the caller did not ask about.
 */
export type FurnitureDataLike = Record<string, unknown>;

function entriesOf(data: FurnitureDataLike, section: string): FurniEntryLike[] {
	const block = data[section];
	if (!block || typeof block !== "object") return [];
	const furnitype = (block as { furnitype?: unknown }).furnitype;
	return Array.isArray(furnitype) ? (furnitype as FurniEntryLike[]) : [];
}

/** Normalise a classname for grouping so `Chair` and `chair` cannot slip past. */
function classnameKey(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length ? trimmed.toLowerCase() : null;
}

function setSection(
	data: FurnitureDataLike,
	section: string,
	kept: FurniEntryLike[],
) {
	data[section] = { ...(data[section] as object), furnitype: kept };
}

/** Classname of an entry, falling back to the normalised grouping key. */
function classnameOf(entry: FurniEntryLike, key: string): string {
	return typeof entry.classname === "string" ? entry.classname : key;
}

/**
 * `revision` is written by the Nitro bundle metadata and rises on every
 * re-import, so it identifies the freshest of two rows for one classname.
 * Missing or non-numeric values sort lowest rather than throwing.
 */
function revisionOf(entry: FurniEntryLike): number {
	const value = entry.revision;
	return typeof value === "number" && Number.isFinite(value) ? value : -1;
}

/** Key-sorted JSON, so two rows compare field-by-field instead of by luck. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		const body = Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
			.join(",");
		return `{${body}}`;
	}
	return JSON.stringify(value ?? null);
}

// ── Asset presence ─────────────────────────────────────────────────

/**
 * Resolved asset directories, cached so a scan over a large FurnitureData
 * does not re-read site settings once per entry.
 */
let assetDirsCache: { nitroDirs: string[]; iconDirs: string[] } | null = null;

async function assetDirs(): Promise<{
	nitroDirs: string[];
	iconDirs: string[];
}> {
	if (assetDirsCache) return assetDirsCache;
	const targets = await getFurniAssetWriteTargets();
	// A file may live only in a mirror directory, so presence is checked
	// across the primary plus every mirror.
	const nitroDirs = [
		targets.nitroDir,
		...targets.mirrorDirs.map((d) => d.nitroDir),
	];
	const iconDirs = [
		targets.iconDir,
		...targets.mirrorDirs.map((d) => d.iconDir),
	];
	assetDirsCache = {
		nitroDirs: [...new Set(nitroDirs)],
		iconDirs: [...new Set(iconDirs)],
	};
	return assetDirsCache;
}

/** Drop the cached directory lookup; used by tests and after a settings change. */
export function __resetGamedataCleanupCache(): void {
	assetDirsCache = null;
}

function existsIn(dirs: string[], fileName: string): boolean {
	return dirs.some((dir) => existsSync(path.join(dir, fileName)));
}

/** True when a bundle (`.hab`, or legacy `.nitro`) exists in any asset dir. */
export async function hasNitroBundle(classname: string): Promise<boolean> {
	const { nitroDirs } = await assetDirs();
	return bundleExistsInDirs(nitroDirs, classname);
}

/** True when a furniture icon for this classname exists in any asset dir. */
export async function hasFurniIcon(classname: string): Promise<boolean> {
	const { iconDirs } = await assetDirs();
	return existsIn(iconDirs, `${classname}_icon.png`);
}

// ── Safety guards ──────────────────────────────────────────────────

/**
 * How many rows one pass may delete before it stops and asks.
 *
 * A wrong `furni_nitro_dir` setting makes every entry look like an orphan, and
 * a wrong FigureMap makes every set look unreferenced. Without a ceiling one
 * misconfigured path turns a cleanup into a full wipe of a file that holds tens
 * of thousands of rows, so a pass that would exceed this throws instead of
 * writing. The caller has to come back with a higher `maxRemovals`.
 */
export const DEFAULT_MAX_REMOVALS = 500;

export class GamedataCleanupLimitError extends Error {
	constructor(
		readonly pass: string,
		readonly wouldRemove: number,
		readonly maxRemovals: number,
	) {
		super(
			`${pass} would remove ${wouldRemove} rows, above the limit of ${maxRemovals}. Check the asset paths or re-run with a higher maxRemovals.`,
		);
		this.name = "GamedataCleanupLimitError";
	}
}

export interface CleanupOptions {
	/** Rows this pass may delete before it refuses. */
	maxRemovals?: number;
}

/** Throws before any write, which is the only moment a limit is useful. */
function assertWithinLimit(
	pass: string,
	wouldRemove: number,
	options?: CleanupOptions,
): void {
	const max = options?.maxRemovals ?? DEFAULT_MAX_REMOVALS;
	if (wouldRemove > max)
		throw new GamedataCleanupLimitError(pass, wouldRemove, max);
}

/**
 * Copy a file aside before it is rewritten, so a pass that turns out to be
 * wrong can be undone by hand. Returns the backup path, or `null` when there
 * was nothing to copy. Only called once a pass has decided to write, so a
 * no-op run leaves no litter.
 */
async function backupBeforeWrite(file: string): Promise<string | null> {
	if (!existsSync(file)) return null;
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const backup = `${file}.bak-${stamp}`;
	await fs.copyFile(file, backup);
	return backup;
}

/**
 * `writeFurniData` rewrites the primary file and every mirror, so all of them
 * need a copy or restoring one file would still leave the others rewritten.
 */
async function backupWriteTargets(): Promise<string[]> {
	const targets = await getFurnitureDataWritePaths();
	const backups: string[] = [];
	for (const target of targets) {
		const backup = await backupBeforeWrite(target);
		if (backup) backups.push(backup);
	}
	return backups;
}

// ── Reporting types ────────────────────────────────────────────────

export interface DuplicateFurniGroup {
	classname: string;
	section: FurnitypeSection;
	/** Indexes into that section's `furnitype` array that will be removed. */
	removeIndexes: number[];
	/** Index that survives. */
	keepIndex: number;
	/** Bundle/icon presence for the classname. Classname-scoped, so shared. */
	hasNitro: boolean;
	hasIcon: boolean;
	/**
	 * True when a removed entry was not an exact copy of the survivor. A pure
	 * copy is safe to drop; a differing one means the duplicate carries data
	 * the survivor does not, so the operator should look before applying.
	 */
	differsFromSurvivor: boolean;
}

export interface CrossSectionClash {
	classname: string;
	sections: FurnitypeSection[];
}

export interface FurniDataOrphan {
	classname: string;
	section: FurnitypeSection;
}

export interface FigureMapPartIssue {
	libraryId: string;
	reason: "missing-set" | "duplicate-part";
	partId: number | null;
	partType: string;
}

export interface FigureSetIssue {
	reason: "unreferenced-set" | "unreferenced-palette";
	id: number;
	setType?: string;
}

/** What every pass did, and how to undo it. */
export interface CleanupOutcome {
	/** Timestamp copies of the files this run was about to rewrite. */
	backups: string[];
	/**
	 * Set when the pass refused to act because its input was empty. An empty
	 * map or an empty set list carries no information, and treating it as
	 * "everything is unused" would delete the whole file.
	 */
	skipped?: string;
}

export interface FurnitureDataDedupeResult extends CleanupOutcome {
	removedDuplicates: number;
	/** Groups where a removed entry differed from the survivor. */
	differingGroups: number;
}

export interface FurnitureDataOrphanResult extends CleanupOutcome {
	removedOrphans: number;
	/** Share of all FurnitureData rows this run removed, 0–1. */
	removedFraction: number;
}

export interface FigureMapCleanupResult extends CleanupOutcome {
	removedParts: number;
	/** Libraries that had parts and were left with none. */
	removedLibraries: number;
}

export interface FigureDataCleanupResult extends CleanupOutcome {
	removedSets: number;
	removedPalettes: number;
}

export interface GamedataCleanupPlan {
	duplicates: DuplicateFurniGroup[];
	crossSection: CrossSectionClash[];
	orphans: FurniDataOrphan[];
	figureMapIssues: FigureMapPartIssue[];
	figureDataIssues: FigureSetIssue[];
	/**
	 * Things a human should look at before running this. A pass refuses to
	 * act on a warning it can prove is dangerous, so these are not decoration.
	 */
	warnings: string[];
}

// ── FurnitureData: duplicates ──────────────────────────────────────

/**
 * Find classnames that appear more than once inside a single section, plus
 * classnames that appear in both sections (reported only — see above).
 *
 * `preloaded` lets a caller that already holds the parsed file hand it over.
 * FurnitureData is tens of megabytes in a real deployment, so parsing it
 * twice in one pass is the difference between one read and two.
 */
export async function scanFurnitureDataDuplicates(
	preloaded?: FurnitureDataLike,
): Promise<{
	duplicates: DuplicateFurniGroup[];
	crossSection: CrossSectionClash[];
}> {
	const data = preloaded ?? ((await readFurniData()) as FurnitureDataLike);
	const duplicates: DuplicateFurniGroup[] = [];
	const sectionsByKey = new Map<string, FurnitypeSection[]>();

	for (const section of FURNITYPE_SECTIONS) {
		const entries = entriesOf(data, section);
		const byKey = new Map<string, number[]>();
		entries.forEach((entry, index) => {
			const key = classnameKey(entry.classname);
			if (!key) return;
			const bucket = byKey.get(key);
			if (bucket) bucket.push(index);
			else byKey.set(key, [index]);
			const sections = sectionsByKey.get(key) ?? [];
			if (!sections.includes(section)) sections.push(section);
			sectionsByKey.set(key, sections);
		});

		for (const [key, indexes] of byKey) {
			if (indexes.length < 2) continue;

			// Both rows name the same bundle, so a file check cannot tell them
			// apart — it is the same answer for every index in the group. The
			// survivor is therefore the newest import (highest `revision`),
			// with the first occurrence breaking a tie so the outcome is
			// stable across runs.
			let keepIndex = indexes[0];
			for (const index of indexes.slice(1))
				if (revisionOf(entries[index]) > revisionOf(entries[keepIndex]))
					keepIndex = index;

			const classname = classnameOf(entries[keepIndex], key);
			const survivor = entries[keepIndex];
			duplicates.push({
				classname,
				section,
				removeIndexes: indexes.filter((index) => index !== keepIndex),
				keepIndex,
				hasNitro: await hasNitroBundle(classname),
				hasIcon: await hasFurniIcon(classname),
				differsFromSurvivor: indexes.some(
					(index) =>
						index !== keepIndex &&
						canonical(entries[index]) !== canonical(survivor),
				),
			});
		}
	}

	const crossSection: CrossSectionClash[] = [];
	for (const [key, sections] of sectionsByKey)
		if (sections.length > 1) crossSection.push({ classname: key, sections });

	return { duplicates, crossSection };
}

/**
 * Remove duplicate FurnitureData entries, keeping the one with the highest
 * revision. Re-reads under the lock, so a plan made minutes ago is never
 * applied to a file that changed in the meantime, and refuses to write past
 * `options.maxRemovals`.
 */
export async function dedupeFurnitureData(
	options?: CleanupOptions,
): Promise<FurnitureDataDedupeResult> {
	return withFurniDataLock(async () => {
		const data = (await readFurniData()) as FurnitureDataLike;
		const { duplicates } = await scanFurnitureDataDuplicates(data);
		if (duplicates.length === 0)
			return {
				removedDuplicates: 0,
				differingGroups: 0,
				backups: [],
			};

		const doomed = new Map<FurnitypeSection, Set<number>>();
		for (const group of duplicates) {
			const set = doomed.get(group.section) ?? new Set<number>();
			for (const index of group.removeIndexes) set.add(index);
			doomed.set(group.section, set);
		}

		let removed = 0;
		for (const [section, indexes] of doomed) {
			const entries = entriesOf(data, section);
			if (!entries.length) continue;
			const kept = entries.filter((_, index) => !indexes.has(index));
			removed += entries.length - kept.length;
			setSection(data, section, kept);
		}
		assertWithinLimit("dedupeFurnitureData", removed, options);
		if (removed === 0)
			return {
				removedDuplicates: 0,
				differingGroups: 0,
				backups: [],
			};

		// A pass can only ever remove part of a group, so the ceiling is
		// applied to the group count too: a file where most rows collide
		// points at a different problem, not at a cleanup.
		const backups = await backupWriteTargets();
		await writeFurniData(data);
		return {
			removedDuplicates: removed,
			differingGroups: duplicates.filter((g) => g.differsFromSurvivor).length,
			backups,
		};
	});
}

// ── FurnitureData: orphans ─────────────────────────────────────────

/** Find FurnitureData entries whose `.nitro` bundle is missing everywhere. */
export async function scanFurnitureDataOrphans(
	preloaded?: FurnitureDataLike,
): Promise<FurniDataOrphan[]> {
	const data = preloaded ?? ((await readFurniData()) as FurnitureDataLike);
	const orphans: FurniDataOrphan[] = [];
	for (const section of FURNITYPE_SECTIONS) {
		for (const entry of entriesOf(data, section)) {
			const key = classnameKey(entry.classname);
			if (!key) continue;
			const classname =
				typeof entry.classname === "string" ? entry.classname : key;
			if (!(await hasNitroBundle(classname)))
				orphans.push({ classname, section });
		}
	}
	return orphans;
}

/**
 * Remove FurnitureData entries that have no `.nitro` bundle on disk.
 *
 * The client cannot render an entry without its bundle, so a leftover row is
 * dead weight that also blocks a clean re-import of that classname.
 */
/**
 * Remove FurnitureData entries that have no `.nitro` bundle on disk.
 *
 * The client cannot render an entry without its bundle, so a leftover row is
 * dead weight that also blocks a clean re-import of that classname.
 *
 * This is the pass that can destroy a whole catalog: with a wrong
 * `furni_nitro_dir` every entry looks orphaned at once. It therefore refuses
 * to write when the removals outnumber `options.maxRemovals`, and reports how
 * much of the file it would touch so the caller can put a human on it.
 */
export async function cleanFurnitureData(
	options?: CleanupOptions,
): Promise<FurnitureDataOrphanResult> {
	return withFurniDataLock(async () => {
		const data = (await readFurniData()) as FurnitureDataLike;
		const total = FURNITYPE_SECTIONS.reduce(
			(sum, section) => sum + entriesOf(data, section).length,
			0,
		);
		const orphans = await scanFurnitureDataOrphans(data);
		if (orphans.length === 0)
			return { removedOrphans: 0, removedFraction: 0, backups: [] };

		const doomed = new Map<FurnitypeSection, Set<string>>();
		for (const orphan of orphans) {
			const set = doomed.get(orphan.section) ?? new Set<string>();
			const key = classnameKey(orphan.classname);
			if (key) set.add(key);
			doomed.set(orphan.section, set);
		}

		let removed = 0;
		for (const [section, keys] of doomed) {
			const entries = entriesOf(data, section);
			if (!entries.length) continue;
			const kept = entries.filter((entry) => {
				const key = classnameKey(entry.classname);
				return !key || !keys.has(key);
			});
			removed += entries.length - kept.length;
			setSection(data, section, kept);
		}
		assertWithinLimit("cleanFurnitureData", removed, options);
		if (removed === 0)
			return { removedOrphans: 0, removedFraction: 0, backups: [] };

		const backups = await backupWriteTargets();
		await writeFurniData(data);
		return {
			removedOrphans: removed,
			removedFraction: total > 0 ? removed / total : 0,
			backups,
		};
	});
}

// ── FigureMap ──────────────────────────────────────────────────────

interface FigurePartLike {
	id?: unknown;
	type?: unknown;
}

interface FigureLibraryLike {
	id: string;
	parts?: unknown;
	[key: string]: unknown;
}

/**
 * Index every FigureData set as `type:id`, which is how a FigureMap part names
 * one. The scan and the cleanup both build this, so a part is judged by the
 * same rule in both — no matching on positions that could drift.
 */
async function figureSetIndex(): Promise<Map<string, Set<number>>> {
	const figureData = await readFigureData();
	const index = new Map<string, Set<number>>();
	for (const setType of figureData.setTypes ?? []) {
		const type = String(setType.type ?? "");
		const ids = index.get(type) ?? new Set<number>();
		for (const set of setType.sets ?? [])
			if (typeof set.id === "number") ids.add(set.id);
		index.set(type, ids);
	}
	return index;
}

function partIdAndType(part: unknown): { id: number | null; type: string } {
	const typed = part as FigurePartLike;
	return {
		id: typeof typed?.id === "number" ? typed.id : null,
		type: typeof typed?.type === "string" ? typed.type : "",
	};
}

/** Parts that point at a missing set, are malformed, or exactly repeat one. */
export async function scanFigureMapIssues(): Promise<FigureMapPartIssue[]> {
	const [libraries, setsByType] = await Promise.all([
		listFigureLibraries(),
		figureSetIndex(),
	]);

	const issues: FigureMapPartIssue[] = [];
	for (const library of libraries) {
		const parts = Array.isArray(library.parts) ? library.parts : [];
		const seen = new Set<string>();
		for (const part of parts) {
			const { id, type } = partIdAndType(part);
			if (id === null) {
				issues.push({
					libraryId: library.id,
					reason: "missing-set",
					partId: null,
					partType: type,
				});
				continue;
			}
			const fingerprint = `${type}:${id}`;
			if (seen.has(fingerprint)) {
				issues.push({
					libraryId: library.id,
					reason: "duplicate-part",
					partId: id,
					partType: type,
				});
				continue;
			}
			seen.add(fingerprint);
			if (!setsByType.get(type)?.has(id))
				issues.push({
					libraryId: library.id,
					reason: "missing-set",
					partId: id,
					partType: type,
				});
		}
	}
	return issues;
}

/**
 * Remove FigureMap parts that reference a set missing from FigureData, plus
 * exact duplicate parts, and drop libraries left with no parts at all.
 *
 * A library that never had a `parts` array is left untouched: that is a
 * "no clothing" figure, not a broken one.
 *
 * An empty FigureData is treated as "no information", not as "every part is
 * broken". That state is what a wrong `figuredata_url` or an interrupted import
 * looks like, and acting on it would strip every library down to nothing.
 */
export async function cleanFigureMap(
	options?: CleanupOptions,
): Promise<FigureMapCleanupResult> {
	const setsByType = await figureSetIndex();
	const file = await getFigureMapPath();

	return withGamedataLock(file, async () => {
		const data = await readGamedataJson<{
			libraries?: FigureLibraryLike[];
		}>(file);
		const libraries = Array.isArray(data.libraries) ? data.libraries : [];
		const totalParts = libraries.reduce(
			(sum, library) =>
				sum + (Array.isArray(library.parts) ? library.parts.length : 0),
			0,
		);
		if (setsByType.size === 0 && totalParts > 0)
			return {
				removedParts: 0,
				removedLibraries: 0,
				backups: [],
				skipped: "FigureData holds no sets, so every part would look broken",
			};

		const keepPart = (part: unknown, seen: Set<string>): boolean => {
			const { id, type } = partIdAndType(part);
			if (id === null) return false;
			const fingerprint = `${type}:${id}`;
			if (seen.has(fingerprint)) return false;
			seen.add(fingerprint);
			return setsByType.get(type)?.has(id) ?? false;
		};

		let removedParts = 0;
		let removedLibraries = 0;
		const next: FigureLibraryLike[] = [];
		for (const library of libraries) {
			if (!Array.isArray(library.parts)) {
				next.push(library);
				continue;
			}
			const seen = new Set<string>();
			const kept = library.parts.filter((part) => keepPart(part, seen));
			removedParts += library.parts.length - kept.length;
			if (kept.length === 0) {
				removedLibraries++;
				continue;
			}
			next.push({ ...library, parts: kept });
		}

		assertWithinLimit("cleanFigureMap", removedParts, options);
		if (removedParts === 0 && removedLibraries === 0)
			return { removedParts: 0, removedLibraries: 0, backups: [] };

		const backups = await backupBeforeWrite(file);
		await writeGamedataJsonAtomic(file, { ...data, libraries: next });
		return {
			removedParts,
			removedLibraries,
			backups: backups ? [backups] : [],
		};
	});
}

// ── FigureData ─────────────────────────────────────────────────────

/** `type:id` fingerprints of every set a FigureMap part actually references. */
async function referencedSetFingerprints(): Promise<Set<string>> {
	const libraries = await listFigureLibraries();
	const referenced = new Set<string>();
	for (const library of libraries)
		for (const part of Array.isArray(library.parts) ? library.parts : []) {
			const { id, type } = partIdAndType(part);
			if (id !== null) referenced.add(`${type}:${id}`);
		}
	return referenced;
}

/** Sets in FigureData no FigureMap part references, and unused palettes. */
export async function scanFigureDataIssues(): Promise<FigureSetIssue[]> {
	const [referenced, figureData] = await Promise.all([
		referencedSetFingerprints(),
		readFigureData(),
	]);

	const issues: FigureSetIssue[] = [];
	const usedPaletteIds = new Set<number>();
	for (const setType of figureData.setTypes ?? []) {
		const type = String(setType.type ?? "");
		if (typeof setType.paletteId === "number")
			usedPaletteIds.add(setType.paletteId);
		for (const set of setType.sets ?? [])
			if (typeof set.id === "number" && !referenced.has(`${type}:${set.id}`))
				issues.push({ reason: "unreferenced-set", id: set.id, setType: type });
	}
	for (const palette of figureData.palettes ?? [])
		if (typeof palette.id === "number" && !usedPaletteIds.has(palette.id))
			issues.push({ reason: "unreferenced-palette", id: palette.id });
	return issues;
}

/**
 * Remove FigureData sets that no FigureMap part references, then remove palettes
 * no set type points at any more.
 *
 * Must run after `cleanFigureMap`; see the note at the top of this file.
 *
 * A FigureMap without any part is the dangerous case: nothing is referenced, so
 * a literal reading deletes every set in the file. That state means the map is
 * missing or empty rather than that the sets are unused, so the pass reports it
 * and leaves the file alone.
 */
export async function cleanFigureData(
	options?: CleanupOptions,
): Promise<FigureDataCleanupResult> {
	const file = await getFigureDataPath();

	return withGamedataLock(file, async () => {
		const [referenced, data] = await Promise.all([
			referencedSetFingerprints(),
			readGamedataJson<{
				palettes?: Array<{ id: number }>;
				setTypes?: Array<{
					type?: string;
					paletteId?: number;
					sets?: Array<{ id: number }>;
				}>;
			}>(file),
		]);

		const setTypes = Array.isArray(data.setTypes) ? data.setTypes : [];
		const totalSets = setTypes.reduce(
			(sum, setType) =>
				sum + (Array.isArray(setType.sets) ? setType.sets.length : 0),
			0,
		);
		if (referenced.size === 0 && totalSets > 0)
			return {
				removedSets: 0,
				removedPalettes: 0,
				backups: [],
				skipped: "FigureMap references no sets, so every set would look unused",
			};

		let removedSets = 0;
		const usedPaletteIds = new Set<number>();
		for (const setType of setTypes) {
			const type = String(setType.type ?? "");
			const sets = Array.isArray(setType.sets) ? setType.sets : [];
			const kept = sets.filter((set) => {
				if (typeof set?.id !== "number") return true;
				return referenced.has(`${type}:${set.id}`);
			});
			removedSets += sets.length - kept.length;
			setType.sets = kept;
			if (typeof setType.paletteId === "number")
				usedPaletteIds.add(setType.paletteId);
		}

		const palettes = Array.isArray(data.palettes) ? data.palettes : [];
		const keptPalettes = palettes.filter(
			(palette) =>
				typeof palette?.id !== "number" || usedPaletteIds.has(palette.id),
		);
		const removedPalettes = palettes.length - keptPalettes.length;

		assertWithinLimit(
			"cleanFigureData",
			removedSets + removedPalettes,
			options,
		);
		if (removedSets === 0 && removedPalettes === 0)
			return { removedSets: 0, removedPalettes: 0, backups: [] };

		const backup = await backupBeforeWrite(file);
		await writeGamedataJsonAtomic(file, {
			...data,
			palettes: keptPalettes,
			setTypes,
		});
		return {
			removedSets,
			removedPalettes,
			backups: backup ? [backup] : [],
		};
	});
}

// ── Combined plan ──────────────────────────────────────────────────

/**
 * Read-only preview of everything the cleanup would do. The apply functions
 * re-derive their own decisions under their locks, so this is a report for the
 * operator, not something that is replayed later.
 */
export async function planGamedataCleanup(): Promise<GamedataCleanupPlan> {
	// FurnitureData is read once and shared by both furniture passes. Reading
	// it inside each pass would parse the whole file twice and hold two copies
	// in memory at the same time.
	const furniData = (await readFurniData()) as FurnitureDataLike;
	const [duplicates, orphans, figureMapIssues, figureDataIssues] =
		await Promise.all([
			scanFurnitureDataDuplicates(furniData),
			scanFurnitureDataOrphans(furniData),
			scanFigureMapIssues(),
			scanFigureDataIssues(),
		]);

	const totalRows = FURNITYPE_SECTIONS.reduce(
		(sum, section) => sum + entriesOf(furniData, section).length,
		0,
	);
	const warnings: string[] = [];
	if (orphans.length > 0 && totalRows > 0) {
		const fraction = Math.round((orphans.length / totalRows) * 100);
		if (fraction >= 50)
			warnings.push(
				`${orphans.length} of ${totalRows} FurnitureData rows have no .nitro bundle (${fraction}%). That usually means the furni_nitro_dir setting points at the wrong directory, not that the catalog is full of dead rows.`,
			);
	}
	if (orphans.length > DEFAULT_MAX_REMOVALS)
		warnings.push(
			`Removing ${orphans.length} orphans is above the limit of ${DEFAULT_MAX_REMOVALS}; the run will stop unless the limit is raised on purpose.`,
		);
	const libraries = (await listFigureLibraries()).length;
	if (libraries === 0 && figureDataIssues.length > 0)
		warnings.push(
			"FigureMap holds no libraries while FigureData reports unused entries; check figuremap_url before cleaning FigureData, or that pass will refuse to run.",
		);
	const differing = duplicates.duplicates.filter(
		(g) => g.differsFromSurvivor,
	).length;
	if (differing > 0)
		warnings.push(
			`${differing} duplicate group(s) are not exact copies of the row that would be kept, so the removed row held data the survivor does not have.`,
		);

	return {
		duplicates: duplicates.duplicates,
		crossSection: duplicates.crossSection,
		orphans,
		figureMapIssues,
		figureDataIssues,
		warnings,
	};
}
