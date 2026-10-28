import "server-only";

import { createHash } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { extname, join } from "node:path";

/**
 * Persistent disk cache for imaging renders (avatars, badges).
 *
 * Renders are immutable per URL, so a successful render is served again and
 * again without touching the upstream renderer. This is what makes imaging
 * resilient: repeated figure requests never exhaust the local imager, and an
 * upstream outage cannot blank images that have rendered once.
 *
 * The tree lives under `storage/` (gitignored) so it survives restarts and
 * stays out of the repository. Old entries are pruned opportunistically so
 * the directory cannot grow without bound.
 */

function maxEntries(): number {
	const raw = (process.env.IMAGING_CACHE_MAX_ENTRIES || "").trim();
	const parsed = Number.parseInt(raw, 10);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 20_000;
}

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Pruning reads and stats every file in the directory, so running it on every
// write costs thousands of syscalls per rendered avatar. A write only needs the
// sweep to have happened "recently enough" — the budget is enforced over hours,
// not per request, so the exact moment does not matter.
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;

// Prune down to this fraction of the budget, so the sweep only runs again after
// a meaningful amount of new renders rather than on the very next write.
const PRUNE_TARGET_RATIO = 0.9;

const IMG_ROOT_DEFAULT = join(process.cwd(), "storage", "imaging");

// Keyed per directory so throttling the avatars sweep does not also throttle the
// badges one.
const lastPruneAt = new Map<string, number>();

function imagingCacheDir(kind: "avatars" | "badges"): string {
	// Unit tests point this at a scratch root so they never read or pollute
	// the runtime cache.
	const root = (process.env.IMAGING_CACHE_ROOT || "").trim();
	return root ? join(root, kind) : join(IMG_ROOT_DEFAULT, kind);
}

export function avatarCacheDir(): string {
	return imagingCacheDir("avatars");
}

export function badgeCacheDir(): string {
	return imagingCacheDir("badges");
}

export interface ImagingCacheRecord {
	body: Uint8Array;
	contentType: string;
}

export function imagingCacheKey(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

export async function readImagingCache(
	directory: string,
	key: string,
): Promise<ImagingCacheRecord | null> {
	try {
		const [img, meta] = await Promise.all([
			readFile(join(directory, `${key}.img`)),
			readFile(join(directory, `${key}.json`), "utf8"),
		]);
		const parsed = JSON.parse(meta) as { contentType?: unknown };
		const contentType =
			typeof parsed.contentType === "string" ? parsed.contentType : "image/png";
		return { body: new Uint8Array(img), contentType };
	} catch {
		// A torn write or a missing entry is simply a cache miss.
		return null;
	}
}

export async function writeImagingCache(
	directory: string,
	key: string,
	body: Uint8Array,
	contentType: string,
): Promise<void> {
	try {
		await mkdir(directory, { recursive: true });
		const base = join(directory, key);
		// Write to temp files and rename twice so a concurrent reader never
		// observes a half-written record; an interrupted write self-heals.
		await writeFile(`${base}.img.tmp`, body);
		await writeFile(
			`${base}.json.tmp`,
			JSON.stringify({ contentType }),
			"utf8",
		);
		await rename(`${base}.img.tmp`, `${base}.img`);
		await rename(`${base}.json.tmp`, `${base}.json`);
		await pruneImagingCache(directory);
	} catch {
		// Caching is best-effort; a failure must never break the render path.
	}
}

/**
 * Keep the cache inside its budget.
 *
 * Records are stored as an `.img`/`.json` pair, so the file count is twice the
 * render count. Age alone is not enough to bound the directory: a burst of
 * popular figures can push it far past the budget while every file is still
 * fresh, and then nothing is ever removed. So expired files go first, and if that
 * is not enough the oldest remaining files go too, down to a low-water mark so
 * the next sweep is not immediately due again.
 */
async function pruneImagingCache(directory: string): Promise<void> {
	try {
		const now = Date.now();
		const lastRun = lastPruneAt.get(directory) ?? 0;
		if (now - lastRun < PRUNE_INTERVAL_MS) return;
		lastPruneAt.set(directory, now);

		const names = await readdir(directory);
		// Group the two halves of each record so a pair is never left orphaned.
		const records = new Map<string, string[]>();
		for (const name of names) {
			const base = name.slice(0, name.length - extname(name).length);
			const files = records.get(base);
			if (files) files.push(name);
			else records.set(base, [name]);
		}
		const budget = maxEntries();
		if (records.size <= budget) return;

		const cutoffMs = now - MAX_AGE_MS;
		const survivors: { files: string[]; mtimeMs: number }[] = [];
		let live = 0;
		for (const files of records.values()) {
			try {
				const info = await stat(join(directory, files[0] as string));
				if (info.mtimeMs < cutoffMs) {
					await removeRecord(directory, files);
					continue;
				}
				survivors.push({ files, mtimeMs: info.mtimeMs });
				live++;
			} catch {
				// Skip records that disappeared between listing and stat.
			}
		}

		const target = Math.floor(budget * PRUNE_TARGET_RATIO);
		if (live <= target) return;
		survivors.sort((a, b) => a.mtimeMs - b.mtimeMs);
		for (const record of survivors) {
			if (live <= target) break;
			try {
				await removeRecord(directory, record.files);
				live--;
			} catch {
				// Already gone.
			}
		}
	} catch {
		// Nothing to prune or directory missing.
	}
}

async function removeRecord(directory: string, files: string[]): Promise<void> {
	for (const name of files) {
		try {
			await unlink(join(directory, name));
		} catch {
			// Already gone.
		}
	}
}
