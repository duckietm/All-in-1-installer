import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripBundleExt } from "@/lib/furni/bundle-file";
import {
	DEFAULT_NITRO_SOURCES,
	listSources,
} from "@/lib/services/clone-sources";
import { getFurniAssetWriteTargets } from "@/lib/services/furni-asset-dirs";
import { getCleanupValidStems } from "@/lib/services/furni-import-cache";
import { downloadFile } from "@/lib/services/import/core/download";
import { parseNitroBundle } from "@/lib/services/swf/nitro-builder";
import { getRuntimePath } from "@/lib/utils/runtime-path";

/**
 * Catalog Studio nitro cleanup.
 *
 * Scans every asset directory (public + mirrored gamedata) for furniture
 * leftovers and splits the found bundles into removable groups:
 *
 *  - "fake" .nitro files whose stem does not match any item in `items_base`
 *    (leftover files that belong to no furniture — including items that were
 *    deleted or imported under a different name);
 *  - "broken" .nitro files that do belong to an item but cannot be parsed as a
 *    valid Nitro bundle (truncated, corrupted or renamed files — e.g. a
 *    download that landed as an HTML error page instead of a bundle);
 *
 * The scan validates bundles with a cheap header-only read (a few KB per file,
 * no decompression) so it stays fast even on 200k+-file nitro directories. A
 * full parse is only attempted for files whose header looks suspicious, so
 * valid bundles are never flagged by a header false-positive.
 *  - orphaned `.swf` / icon files whose stem matches no item in `items_base`.
 *
 * Deletion only touches the asset files on disk — never database rows. Broken
 * bundles can be re-downloaded from the configured nitro sources instead of
 * being deleted, and fake bundles older than a configurable age can be removed
 * automatically for self-cleaning nitro directories.
 */

export type CleanupAssetKind = "nitro" | "swf" | "icon";

export interface AssetCleanupEntry {
	fileName: string;
	base: string;
	size: number;
	dirs: string[];
	lastModified: number;
}

export interface NitroCleanupEntry extends AssetCleanupEntry {
	error?: string;
}

export interface NitroCleanupScan {
	fake: NitroCleanupEntry[];
	broken: NitroCleanupEntry[];
	orphanedSwf: AssetCleanupEntry[];
	orphanedIcon: AssetCleanupEntry[];
	total: number;
	/** True when the result was served from the on-disk scan cache. */
	cached?: boolean;
}

export interface CleanupProgress {
	phase: "stems" | "readdir" | "validate" | "done";
	scanned: number;
}

export interface CleanupScanOptions {
	/** Bypass the scan cache and re-validate every bundle. */
	force?: boolean;
	/**
	 * Coarse progress callback used to stream scan status to the UI instead of
	 * leaving the tab looking frozen while a large directory is processed.
	 */
	onProgress?: (progress: CleanupProgress) => void;
	/**
	 * Aborts the scan. Every CPU-bound stage (readdir, stat pool, header
	 * validation) checks the signal and throws an `AbortError`-named error, so a
	 * cancelled scan never writes a partial result to the on-disk cache.
	 */
	signal?: AbortSignal;
}

export interface NitroCleanupDeleteResult {
	/** Files that were fully removed from every matching directory. */
	deleted: number;
	/** Individual files removed across all directories (mirrors). */
	copiesRemoved: number;
	errors: string[];
	files: Array<{ fileName: string; deleted: boolean; remaining: string[] }>;
}

export interface NitroRepairResult {
	repaired: number;
	failed: number;
	errors: string[];
	files: Array<{ fileName: string; ok: boolean; error?: string }>;
}

export interface NitroAutoCleanResult extends NitroCleanupDeleteResult {
	/** Fake bundles skipped because they are younger than the age threshold. */
	skippedRecent: number;
	/** Broken bundles skipped — only fake leftovers are auto-removed. */
	skippedBroken: number;
}

// Both bundle extensions: `.hab` is what imports write today, `.nitro` is the
// legacy name still covering the bulk of the on-disk asset set. Both must be
// scanned — matching only one would leave the other invisible to the fake /
// broken classification and to the nightly auto-clean.
const NITRO_FILE_RE = /^[a-z0-9_*\-.]+\.(?:nitro|hab)$/i;
const SWF_FILE_RE = /^[a-z0-9_*\-.]+\.swf$/i;
const ICON_FILE_RE = /^[a-z0-9_*\-.]+\.(?:gif|png)$/i;

/**
 * Only this many leading bytes of a `.nitro` bundle are read during the fake /
 * broken scan. The header (file count + two embedded file names + zlib payload
 * lengths) is tiny, and a zlib/gzip-signed JSON stream is enough to confirm a
 * bundle is structurally valid without decompressing the large PNG texture.
 */
const NITRO_HEADER_SAMPLE_BYTES = 2048;

/**
 * Minimum + maximum plausible header fields for a Nitro bundle. A bundle always
 * contains at least two files (a `.json` config stream and a `.png` texture
 * stream). File-name length fields and compressed stream lengths are bounded so
 * a bundle whose header claims absurd sizes (e.g. a download that landed as an
 * HTML error page, or a truncated/zero-filled file) can be rejected without
 * decompressing anything.
 */
const NITRO_MIN_FILES = 2;
const NITRO_NAME_LEN_MAX = 1024;
const NITRO_COMPRESSED_LEN_MAX = 512 * 1024 * 1024;
const KIND_FILE_RE: Record<CleanupAssetKind, RegExp> = {
	nitro: NITRO_FILE_RE,
	swf: SWF_FILE_RE,
	icon: ICON_FILE_RE,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function abortSignalReason(): Error {
	const error = new Error("Scan cancelled");
	error.name = "AbortError";
	return error;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortSignalReason();
}

function uniqueDirs(dirs: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const dir of dirs) {
		const key = process.platform === "win32" ? dir.toLowerCase() : dir;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(dir);
	}
	return out;
}

/** Sliding-window worker pool: keeps up to `concurrency` tasks in flight. */
async function runPool<T>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	const limit = Math.min(Math.max(concurrency, 1), items.length);
	if (limit === 0) return;
	let next = 0;
	await Promise.allSettled(
		Array.from({ length: limit }, async () => {
			while (true) {
				const i = next++;
				if (i >= items.length) break;
				await worker(items[i]);
			}
		}),
	);
}

/**
 * Cheap header-only validation that mirrors `parseNitroBundle`'s byte layout
 * (used by `swf/nitro-builder`): a bundle starts with a big-endian file count
 * followed by `(nameLen:int16, name:utf8, compressedLen:int32)` pairs. We read
 * only `NITRO_HEADER_SAMPLE_BYTES` of leading bytes (no decompression) and
 * reject bundles whose header claims absurd sizes — e.g. a download that landed
 * as an HTML error page, or a truncated/zero-filled file.
 *
 * Returns `false` when the header is clearly implausible. When the file cannot
 * be opened/read (including mocked test environments where the path does not
 * exist) it also returns `false`, which makes the caller fall back to the
 * expensive full `parseNitroBundle` — so tests that supply buffers via
 * `readFileFn` keep working unchanged.
 */
async function hasValidNitroHeader(filePath: string): Promise<boolean> {
	let handle: import("node:fs/promises").FileHandle | undefined;
	try {
		handle = await fs.open(filePath, "r");
		const sample = Buffer.alloc(NITRO_HEADER_SAMPLE_BYTES);
		const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
		if (bytesRead < 8) return false;

		let offset = 0;
		const fileCount = sample.readInt16BE(offset);
		offset += 2;
		if (fileCount < NITRO_MIN_FILES) return false;
		if (fileCount > 16) return false;

		for (let i = 0; i < fileCount && offset < bytesRead - 2; i++) {
			const nameLen = sample.readInt16BE(offset);
			offset += 2;
			if (nameLen < 1 || nameLen > NITRO_NAME_LEN_MAX) return false;
			// The name field must be printable utf-8; an HTML error page or
			// zero-filled buffer almost always trips this.
			if (offset + nameLen > bytesRead) return false;
			const name = sample.toString("utf-8", offset, offset + nameLen);
			offset += nameLen;
			if (!/^[\x20-\x7e]+$/.test(name)) return false;
			if (offset + 4 > bytesRead) return true;
			const compressedLen = sample.readInt32BE(offset);
			offset += 4;
			if (compressedLen <= 0 || compressedLen > NITRO_COMPRESSED_LEN_MAX) {
				return false;
			}
		}
		return true;
	} catch {
		return false;
	} finally {
		await handle?.close().catch(() => {});
	}
}

interface DirectoryRead {
	name: string;
	base: string;
	size: number;
	lastModified: number;
}

/** Discriminated cache key per asset directory (kind + path). */
function kindKey(kind: CleanupAssetKind, dir: string): string {
	return `${kind}\0${dir}`;
}

async function readDirNames(dir: string, regex: RegExp): Promise<string[]> {
	const names = await fs.readdir(dir).catch(() => [] as string[]);
	return names.filter((name) => regex.test(name)).sort();
}

/** Cheap fingerprint of a directory listing — a rename/add/remove changes it. */
function dirNameSignature(names: string[]): string {
	const hash = createHash("sha1");
	for (const name of names) hash.update(name).update("\n");
	return hash.digest("hex");
}

/**
 * How many `stat` calls run in parallel while reading an asset directory.
 * Directories can hold hundreds of thousands of files; serial `stat`ing them
 * is the single biggest cost of the scan, so the work is spread over a pool.
 */
const DIR_STAT_CONCURRENCY = 32;

async function buildDirEntries(
	dir: string,
	names: string[],
	signal?: AbortSignal,
): Promise<DirectoryRead[]> {
	const entries: DirectoryRead[] = [];
	await runPool(names, DIR_STAT_CONCURRENCY, async (name) => {
		throwIfAborted(signal);
		let size = 0;
		let mtimeMs = 0;
		try {
			const stat = await fs.stat(getRuntimePath(dir, name));
			size = stat.size;
			mtimeMs = stat.mtimeMs;
		} catch {
			/* ignore unreadable entry */
		}
		entries.push({
			name,
			base: name.replace(/\.[a-z0-9]+$/i, ""),
			size,
			lastModified: mtimeMs,
		});
	});
	return entries;
}

async function collectAssets(
	kind: CleanupAssetKind,
	dirs: string[],
	namesByKey: Map<string, string[]>,
	signal?: AbortSignal,
): Promise<Map<string, AssetCleanupEntry>> {
	const byName = new Map<string, AssetCleanupEntry>();
	for (const dir of dirs) {
		throwIfAborted(signal);
		const names = namesByKey.get(kindKey(kind, dir)) ?? [];
		for (const read of await buildDirEntries(dir, names, signal)) {
			const entry = byName.get(read.name) ?? {
				fileName: read.name,
				base: read.base,
				size: 0,
				dirs: [],
				lastModified: 0,
			};
			if (!entry.dirs.includes(dir)) entry.dirs.push(dir);
			entry.size = Math.max(entry.size, read.size);
			entry.lastModified = Math.max(entry.lastModified, read.lastModified);
			byName.set(read.name, entry);
		}
	}
	return byName;
}

// ── On-disk scan cache ──────────────────────────────────────────────────────
//
// The heavy parts of a scan are the per-bundle header validation (one open +
// small read per .nitro) and the parallel stat pass. Both can be skipped when
// no asset directory changed since the last scan: a signature per directory is
// derived from the sortable file *list* (readdir + hash, no stat). Any add /
// remove / rename invalidates the cache and triggers a full re-validation.
// Bundles rewritten in place without a name change are not detected by the
// signature; run a forced scan (`force: true`) to pick those up.

const SCAN_CACHE_DIR = path.join(process.cwd(), "storage", "nitro-cleanup");
const scanCachePath = () => path.join(SCAN_CACHE_DIR, "scan-cache.json");

interface ScanCacheFile {
	dirs: Record<string, string>;
	result: Omit<NitroCleanupScan, "cached">;
}

async function readScanCache(): Promise<ScanCacheFile | null> {
	try {
		if (!existsSync(scanCachePath())) return null;
		const raw = await fs.readFile(scanCachePath(), "utf8");
		const parsed = JSON.parse(raw) as ScanCacheFile;
		if (!parsed || typeof parsed.dirs !== "object" || !parsed.result) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

async function writeScanCache(
	dirs: Record<string, string>,
	result: Omit<NitroCleanupScan, "cached">,
): Promise<void> {
	try {
		await fs.mkdir(SCAN_CACHE_DIR, { recursive: true });
		await fs.writeFile(scanCachePath(), JSON.stringify({ dirs, result }));
	} catch {
		/* cache is best effort — a broken cache simply re-scans next time */
	}
}

function cacheDirsMatch(
	cached: Record<string, string>,
	current: Record<string, string>,
): boolean {
	const cachedKeys = Object.keys(cached);
	if (cachedKeys.length !== Object.keys(current).length) return false;
	for (const key of cachedKeys) {
		if (cached[key] !== current[key]) return false;
	}
	return true;
}

export async function scanFakeBrokenNitros(
	options: CleanupScanOptions = {},
): Promise<NitroCleanupScan> {
	const { force = false, onProgress, signal } = options;
	const targets = await getFurniAssetWriteTargets();
	const nitroDirs = uniqueDirs([
		targets.nitroDir,
		...targets.mirrorDirs.map((d) => d.nitroDir),
	]);
	const swfDirs = uniqueDirs([
		targets.swfDir,
		...targets.mirrorDirs.map((d) => d.swfDir),
	]);
	const iconDirs = uniqueDirs([
		targets.iconDir,
		...targets.mirrorDirs.map((d) => d.iconDir),
	]);
	const directoryPlan: Array<{
		kind: CleanupAssetKind;
		dirs: string[];
	}> = [
		{ kind: "nitro", dirs: nitroDirs },
		{ kind: "swf", dirs: swfDirs },
		{ kind: "icon", dirs: iconDirs },
	];

	onProgress?.({ phase: "readdir", scanned: 0 });

	// One readdir pass shared by both the cache signature and the full scan —
	// never stat a file just to learn the directory changed.
	const namesByKey = new Map<string, string[]>();
	await Promise.all(
		directoryPlan.flatMap(({ kind, dirs }) =>
			dirs.map(async (dir) => {
				throwIfAborted(signal);
				namesByKey.set(
					kindKey(kind, dir),
					await readDirNames(dir, KIND_FILE_RE[kind]),
				);
			}),
		),
	);
	const currentDigests: Record<string, string> = {};
	for (const key of namesByKey.keys()) {
		currentDigests[key] = dirNameSignature(namesByKey.get(key) ?? []);
	}

	throwIfAborted(signal);
	onProgress?.({ phase: "readdir", scanned: 0 });
	if (!force) {
		const cache = await readScanCache();
		if (cache && cacheDirsMatch(cache.dirs, currentDigests)) {
			onProgress?.({ phase: "done", scanned: cache.result.total });
			return { ...cache.result, cached: true };
		}
	}

	throwIfAborted(signal);
	// Needed only for classification — skip the DB query on a cache hit.
	onProgress?.({ phase: "stems", scanned: 0 });
	const validStems = await getCleanupValidStems();

	const [byNitro, bySwf, byIcon] = await Promise.all([
		collectAssets("nitro", nitroDirs, namesByKey, signal),
		collectAssets("swf", swfDirs, namesByKey, signal),
		collectAssets("icon", iconDirs, namesByKey, signal),
	]);

	const entries: NitroCleanupEntry[] = [...byNitro.values()];
	const fake: NitroCleanupEntry[] = [];
	const broken: NitroCleanupEntry[] = [];
	let validated = 0;
	const totalToValidate = entries.length;

	await runPool(entries, 16, async (entry) => {
		throwIfAborted(signal);
		// A .nitro that no DB item maps to is a leftover / fake bundle.
		if (!validStems.has(entry.base.toLowerCase())) {
			fake.push(entry);
		} else {
			// Otherwise validate the bundle content. Most bundles pass a cheap
			// header-only check (a few KB, no decompression); only files whose
			// header looks suspicious get the expensive full parse. This keeps
			// the scan fast even on directories with hundreds of thousands of
			// bundles.
			let parsed = false;
			let firstError = "";
			for (const dir of entry.dirs) {
				if (await hasValidNitroHeader(getRuntimePath(dir, entry.fileName))) {
					parsed = true;
					break;
				}
				try {
					parseNitroBundle(
						await fs.readFile(getRuntimePath(dir, entry.fileName)),
					);
					parsed = true;
					break;
				} catch (err) {
					firstError = (err as Error).message;
				}
			}
			if (!parsed) {
				broken.push({ ...entry, error: firstError });
			}
		}
		validated++;
		if (validated % 2500 === 0 || validated === totalToValidate) {
			onProgress?.({ phase: "validate", scanned: validated });
		}
	});

	const orphanedSwf = [...bySwf.values()].filter(
		(entry) => !validStems.has(entry.base.toLowerCase()),
	);
	const orphanedIcon = [...byIcon.values()].filter(
		(entry) => !validStems.has(entry.base.toLowerCase()),
	);

	const byName = <T extends { fileName: string }>(entries: T[]): T[] =>
		entries.sort((a, b) => a.fileName.localeCompare(b.fileName));

	const result: NitroCleanupScan = {
		fake: byName(fake),
		broken: byName(broken),
		orphanedSwf: byName(orphanedSwf),
		orphanedIcon: byName(orphanedIcon),
		total: byNitro.size + bySwf.size + byIcon.size,
	};
	throwIfAborted(signal);
	await writeScanCache(currentDigests, result);
	onProgress?.({ phase: "done", scanned: result.total });
	return result;
}

function dirsForKind(
	targets: Awaited<ReturnType<typeof getFurniAssetWriteTargets>>,
	kind: CleanupAssetKind,
): string[] {
	const primary = {
		nitro: targets.nitroDir,
		swf: targets.swfDir,
		icon: targets.iconDir,
	}[kind];
	const mirrors = targets.mirrorDirs.map((d) => d[`${kind}Dir` as const]);
	return uniqueDirs([primary, ...mirrors]);
}

/** Delete asset files from every matching directory (primary + mirrors). */
export async function deleteNitroCleanupFiles(
	fileNames: string[],
	kind: CleanupAssetKind = "nitro",
): Promise<NitroCleanupDeleteResult> {
	const targets = await getFurniAssetWriteTargets();
	const dirs = dirsForKind(targets, kind);
	const fileRegex = KIND_FILE_RE[kind];

	let deleted = 0;
	let copiesRemoved = 0;
	const errors: string[] = [];
	const files: NitroCleanupDeleteResult["files"] = [];

	for (const rawName of [...new Set(fileNames)]) {
		const fileName = String(rawName ?? "");
		if (!fileRegex.test(fileName)) {
			errors.push(`Invalid ${kind} file name: ${fileName}`);
			files.push({ fileName, deleted: false, remaining: [] });
			continue;
		}
		const remaining: string[] = [];
		let existed = false;
		for (const dir of dirs) {
			const filePath = getRuntimePath(dir, fileName);
			if (!existsSync(filePath)) continue;
			existed = true;
			try {
				await fs.unlink(filePath);
				copiesRemoved++;
			} catch (err) {
				remaining.push(dir);
				errors.push(`${fileName} in ${dir}: ${(err as Error).message}`);
			}
		}
		const fullyDeleted = existed && remaining.length === 0;
		if (fullyDeleted) deleted++;
		files.push({ fileName, deleted: fullyDeleted, remaining });
	}

	return { deleted, copiesRemoved, errors, files };
}

export function ageDays(lastModified: number): number {
	if (!lastModified) return 0;
	return Math.max(0, Math.floor((Date.now() - lastModified) / DAY_MS));
}

/**
 * Automatically remove fake .nitro leftovers that are older than
 * `maxAgeDays`. Broken bundles and young fake bundles are never touched —
 * only former leftovers whose items are long gone from the database.
 */
export async function autoCleanFakeNitros(
	maxAgeDays = 30,
): Promise<NitroAutoCleanResult> {
	const scan = await scanFakeBrokenNitros();
	const threshold = Math.max(0, Math.floor(maxAgeDays));
	const removable = scan.fake.filter(
		(entry) => ageDays(entry.lastModified) >= threshold,
	);
	const result = await deleteNitroCleanupFiles(
		removable.map((entry) => entry.fileName),
		"nitro",
	);
	return {
		...result,
		skippedRecent: scan.fake.length - removable.length,
		skippedBroken: scan.broken.length,
	};
}

export async function getPersistedCleanupResult(): Promise<NitroCleanupScan | null> {
	const cache = await readScanCache();
	return cache?.result ?? null;
}

/**
 * Keep the on-disk scan cache consistent after a mutation without re-scanning:
 * recompute the directory signatures for the touched asset kind (cheap readdir
 * pass — no stats, no header validation) and drop the removed file names from
 * the cached result lists. Without this, the next non-forced scan would see a
 * digest mismatch (e.g. after a delete) and re-validate the whole directory.
 */
export async function refreshScanCacheAfterMutation(
	kind: CleanupAssetKind,
	fileNames: string[],
	removedCount = fileNames.length,
): Promise<void> {
	const remove = new Set(fileNames);
	if (remove.size === 0) return;
	const cache = await readScanCache();
	if (!cache) return;

	const targets = await getFurniAssetWriteTargets();
	for (const dir of dirsForKind(targets, kind)) {
		cache.dirs[kindKey(kind, dir)] = dirNameSignature(
			await readDirNames(dir, KIND_FILE_RE[kind]),
		);
	}

	const result = cache.result;
	if (kind === "nitro") {
		result.fake = result.fake.filter((e) => !remove.has(e.fileName));
		result.broken = result.broken.filter((e) => !remove.has(e.fileName));
	} else if (kind === "swf") {
		result.orphanedSwf = result.orphanedSwf.filter(
			(e) => !remove.has(e.fileName),
		);
	} else {
		result.orphanedIcon = result.orphanedIcon.filter(
			(e) => !remove.has(e.fileName),
		);
	}
	result.total = Math.max(0, result.total - removedCount);
	await writeScanCache(cache.dirs, result);
}

// ── Auto-clean history ──────────────────────────────────────────────────────
//
// The nightly scheduled auto-clean and the manual button both record a history
// entry so staff can see what the jobs worker removed and when.

export interface NitroAutoCleanHistoryEntry {
	triggeredAt: string;
	triggeredBy: "manual" | "scheduled";
	maxAgeDays: number;
	deleted: number;
	copiesRemoved: number;
	skippedRecent: number;
	skippedBroken: number;
	errors: string[];
}

const HISTORY_MAX_ENTRIES = 50;
const historyPath = () => path.join(SCAN_CACHE_DIR, "history.json");

export async function readAutoCleanHistory(): Promise<
	NitroAutoCleanHistoryEntry[]
> {
	try {
		if (!existsSync(historyPath())) return [];
		const parsed = JSON.parse(await fs.readFile(historyPath(), "utf8"));
		if (!Array.isArray(parsed)) return [];
		return parsed as NitroAutoCleanHistoryEntry[];
	} catch {
		return [];
	}
}

export async function appendAutoCleanHistory(
	entry: NitroAutoCleanHistoryEntry,
): Promise<void> {
	try {
		const history = (await readAutoCleanHistory()).slice(
			0,
			HISTORY_MAX_ENTRIES - 1,
		);
		await fs.mkdir(SCAN_CACHE_DIR, { recursive: true });
		await fs.writeFile(historyPath(), JSON.stringify([entry, ...history]));
	} catch {
		/* best effort — history is never fatal */
	}
}

/**
 * Refresh the scan cache + append a history entry after an auto-clean run.
 * Shared by the manual route and the nightly scheduled job.
 */
export async function finishAutoClean(options: {
	result: NitroAutoCleanResult;
	maxAgeDays: number;
	triggeredBy: "manual" | "scheduled";
}): Promise<void> {
	const removed = options.result.files
		.filter((file) => file.deleted)
		.map((file) => file.fileName);
	await refreshScanCacheAfterMutation("nitro", removed, options.result.deleted);
	await appendAutoCleanHistory({
		triggeredAt: new Date().toISOString(),
		triggeredBy: options.triggeredBy,
		maxAgeDays: options.maxAgeDays,
		deleted: options.result.deleted,
		copiesRemoved: options.result.copiesRemoved,
		skippedRecent: options.result.skippedRecent,
		skippedBroken: options.result.skippedBroken,
		errors: options.result.errors,
	});
}

/**
 * Entry point for the nightly jobs-worker cron. Never runs while an interactive
 * scan session is in flight, so scheduled deletion can't race the UI.
 */
export async function scheduledAutoCleanFakeNitros(
	maxAgeDays = 30,
): Promise<{ skipped: boolean; deleted?: number }> {
	const { isSessionStale, readScanSession } = await import(
		"./nitro-scan-session"
	);
	const session = await readScanSession();
	if (session?.state === "running" && !isSessionStale(session)) {
		return { skipped: true };
	}
	const result = await autoCleanFakeNitros(maxAgeDays);
	await finishAutoClean({
		result,
		maxAgeDays,
		triggeredBy: "scheduled",
	});
	return { skipped: false, deleted: result.deleted };
}

async function copyFileToDirs(
	buffer: Buffer,
	fileName: string,
	dirs: string[],
): Promise<string[]> {
	const errors: string[] = [];
	for (const dir of dirs) {
		try {
			await fs.mkdir(dir, { recursive: true });
			await fs.writeFile(getRuntimePath(dir, fileName), buffer);
		} catch (err) {
			errors.push(`write .nitro to ${dir} failed: ${(err as Error).message}`);
		}
	}
	return errors;
}

export interface NitroRepairProgress {
	completed: number;
	total: number;
	ok: number;
	failed: number;
	fileName?: string;
	error?: string;
}

/**
 * Re-download broken .nitro bundles from the configured nitro sources. The
 * file stem matched an item in `items_base`, so the same classname candidates
 * used by repair-nitros.ts are tried; every downloaded bundle is validated
 * before it replaces the broken copies across all nitro directories. Bundles
 * are repaired in parallel (pool of 6) and `onProgress` is called after each
 * one settles, so a huge batch can be streamed to the client and cancelled.
 */
export async function repairBrokenNitros(
	fileNames: string[],
	options: { onProgress?: (progress: NitroRepairProgress) => void } = {},
): Promise<NitroRepairResult> {
	const { onProgress } = options;
	const targets = await getFurniAssetWriteTargets();
	const nitroDirs = dirsForKind(targets, "nitro");
	let sources = (await listSources().catch(() => [] as never)).filter(
		(source: { nitroBaseUrl?: string }) => source.nitroBaseUrl,
	);
	if (sources.length === 0) sources = DEFAULT_NITRO_SOURCES as never;

	let repaired = 0;
	let failed = 0;
	const errors: string[] = [];
	const files: NitroRepairResult["files"] = [];
	const uniqueFileNames = [...new Set(fileNames)];
	const total = uniqueFileNames.length;
	let completed = 0;
	const finish = (fileName: string, ok: boolean, error?: string) => {
		completed++;
		if (ok) repaired++;
		else failed++;
		onProgress?.({ completed, total, ok: repaired, failed, fileName, error });
	};

	await runPool(uniqueFileNames, 6, async (rawName) => {
		const fileName = String(rawName ?? "");
		// `stripBundleExt` only peels the extension — it does not make the stem
		// safe to join into a path. The character-class regex is what rejects
		// traversal payloads like `../evil.nitro` before any download runs.
		const name =
			NITRO_FILE_RE.test(fileName) && stripBundleExt(fileName) !== null
				? stripBundleExt(fileName)
				: null;
		if (name === null) {
			const message = `Invalid nitro file name: ${fileName}`;
			errors.push(message);
			files.push({ fileName, ok: false, error: message });
			finish(fileName, false, message);
			return;
		}
		const candidates = [
			name,
			...(name.includes("*")
				? [name.split("*")[0], name.replace(/\*/g, "_")]
				: []),
			...(name.includes(".") ? [name.replace(/\./g, "_")] : []),
		];
		for (const source of sources as {
			name: string;
			nitroBaseUrl?: string;
		}[]) {
			for (const candidate of candidates) {
				const base = source.nitroBaseUrl;
				if (!base) continue;
				const tmpPath = getRuntimePath(
					os.tmpdir(),
					`.repair_nitro_${name}_${Math.random().toString(36).slice(2, 8)}.nitro`,
				);
				try {
					const dl = await downloadFile(
						`${base.replace(/\/+$/, "")}/${encodeURIComponent(candidate)}.nitro`,
						tmpPath,
						{ maxRetries: 1, validate: "nitro" },
					);
					if (dl.ok) {
						const buffer = await fs.readFile(tmpPath);
						parseNitroBundle(buffer);
						const writeErrors = await copyFileToDirs(
							buffer,
							fileName,
							nitroDirs,
						);
						if (writeErrors.length === 0) {
							files.push({ fileName, ok: true });
							finish(fileName, true);
						} else {
							errors.push(...writeErrors);
							files.push({
								fileName,
								ok: false,
								error: writeErrors[0],
							});
							finish(fileName, false, writeErrors[0]);
						}
						return;
					}
				} catch (err) {
					errors.push(
						`repair ${fileName} from ${source.name} failed: ${(err as Error).message}`,
					);
				} finally {
					await fs.unlink(tmpPath).catch(() => {});
				}
			}
		}
		const message = "could not re-obtain bundle from any nitro source";
		errors.push(`could not re-obtain ${fileName} from any nitro source`);
		files.push({
			fileName,
			ok: false,
			error: message,
		});
		finish(fileName, false, message);
	});

	return { repaired, failed, errors, files };
}
