import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import { sql } from "drizzle-orm";
import { queryRows } from "@/lib/db";
import { bundleFileNames, stripBundleExt } from "@/lib/furni/bundle-file";
import { LOCAL_BUNDLE_EXT } from "@/lib/furni/classname";
import {
	type CloneSource,
	DEFAULT_NITRO_SOURCES,
	listSources,
} from "@/lib/services/clone-sources";
import {
	type FurniAssetWriteTargets,
	getFurniAssetWriteTargets,
	getGamedataRoot,
} from "@/lib/services/furni-asset-dirs";
import { downloadFile } from "@/lib/services/import/core/download";
import { classifyCatalogItem, NO_ASSET_KINDS } from "@/lib/services/item-kind";
import { parseNitroBundle } from "@/lib/services/swf/nitro-builder";
import { getRuntimePath } from "@/lib/utils/runtime-path";
import { ensureDirectories } from "./furni-import";
import { addSize32ToBundle } from "./swf/add-size32";

const REPAIR_CONCURRENCY = 6;

/** Sliding-window worker pool: keeps up to `concurrency` tasks in flight. */
async function runPool<T>(
	items: T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
	const limit = Math.min(Math.max(concurrency, 1), items.length);
	if (limit === 0) return;
	let next = 0;
	await Promise.allSettled(
		Array.from({ length: limit }, async () => {
			while (true) {
				const i = next++;
				if (i >= items.length) break;
				await worker(items[i], i);
			}
		}),
	);
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

async function writeNitroToDirs(
	nitro: Buffer,
	dirs: string[],
	fileName: string,
): Promise<string[]> {
	const errors: string[] = [];
	for (const dir of dirs) {
		try {
			await fs.mkdir(dir, { recursive: true });
			await fs.writeFile(getRuntimePath(dir, fileName), nitro);
		} catch (err) {
			errors.push(`write .nitro to ${dir} failed: ${(err as Error).message}`);
		}
	}
	return errors;
}

async function copyNitroAcrossDirs(
	srcDir: string,
	destDirs: string[],
	fileName: string,
): Promise<string[]> {
	const errors: string[] = [];
	const src = getRuntimePath(srcDir, fileName);
	for (const dir of destDirs) {
		if (dir === srcDir) continue;
		try {
			await fs.mkdir(dir, { recursive: true });
			await fs.copyFile(src, getRuntimePath(dir, fileName));
		} catch (err) {
			errors.push(`copy .nitro to ${dir} failed: ${(err as Error).message}`);
		}
	}
	return errors;
}

export interface RepairNitroEvent {
	type: "started" | "progress" | "done" | "batch_complete" | "error";
	classname?: string;
	status?: string;
	index?: number;
	total?: number;
	message?: string;
	warnings?: string[];
	succeeded?: number;
	failed?: number;
	skipped?: number;
	existing?: number;
	duration?: number;
}

export async function repairMissingNitros(
	onEvent?: (evt: RepairNitroEvent) => void,
): Promise<{ succeeded: number; failed: number; skipped: number }> {
	let succeeded = 0;
	let failed = 0;
	let skipped = 0;

	try {
		await ensureDirectories();
	} catch (err) {
		onEvent?.({
			type: "error",
			message: `ensureDirectories failed: ${(err as Error).message}`,
		});
		return { succeeded: 0, failed: 0, skipped: 0 };
	}

	let targets: FurniAssetWriteTargets;
	try {
		targets = await getFurniAssetWriteTargets();
	} catch (err) {
		onEvent?.({
			type: "error",
			message: `getFurniAssetWriteTargets failed: ${(err as Error).message}`,
		});
		return { succeeded: 0, failed: 0, skipped: 0 };
	}

	// Every location the app mirrors furni assets into — the webroot (public/)
	// plus the live gamedata (e.g. /var/www/Gamedata). Repair writes to all of
	// them so both the CMS and the client see the .nitro.
	const nitroDirs = uniqueDirs([
		targets.nitroDir,
		...targets.mirrorDirs.map((d) => d.nitroDir),
	]);

	// Badges and other special items (pets, effects, bots, sticky notes) never
	// ship furni `.nitro` bundles — resolve the skip set from the DB so badge
	// detection is precise (`items_base.type = 'b'`) instead of relying only on
	// which .gif files happen to exist in the album directory.
	let albumBadgeSet: Set<string> | null = null;
	try {
		const gamedataRoot = await getGamedataRoot();
		if (gamedataRoot) {
			const badgeFiles = await fs
				.readdir(getRuntimePath(gamedataRoot, "album1584"))
				.catch(() => [] as string[]);
			albumBadgeSet = new Set(
				badgeFiles.filter((f) => f.endsWith(".gif")).map((f) => f.slice(0, -4)),
			);
		}
	} catch {
		albumBadgeSet = null;
	}

	let items: Array<{
		id: number;
		item_name: string;
		public_name: string;
		type: string;
		interaction_type: string;
	}>;
	try {
		items = await queryRows<(typeof items)[number]>(sql`
			SELECT id, item_name, public_name, type, interaction_type FROM items_base ORDER BY id
		`);
	} catch (err) {
		onEvent?.({
			type: "error",
			message: `Database query failed: ${(err as Error).message}`,
		});
		return { succeeded: 0, failed: 0, skipped: 0 };
	}

	// Build the authoritative skip set from the DB, supplemented by album .gifs.
	const skipSet = new Set<string>();
	for (const item of items) {
		if (NO_ASSET_KINDS.has(classifyCatalogItem(item))) {
			skipSet.add(item.item_name);
		}
	}
	for (const code of albumBadgeSet ?? []) {
		skipSet.add(code);
	}

	const total = items.length;
	onEvent?.({ type: "started", total });

	// A row can have its real classname in either `item_name` or `public_name`.
	const classnameCandidates = (item: (typeof items)[number]): string[] => {
		const out: string[] = [];
		const add = (n?: string | null) => {
			if (n && !out.includes(n)) out.push(n);
		};
		add(item.item_name);
		if (
			item.public_name &&
			item.public_name !== item.item_name &&
			!item.public_name.includes(" ") &&
			item.public_name !== "0"
		) {
			add(item.public_name);
		}
		return out;
	};

	const processItem = async (item: (typeof items)[number]) => {
		const classname = item.item_name;
		// Special items (badges, pets, effects, bots, sticky notes) don't have
		// furni .nitro bundles to repair. Skip them.
		if (skipSet.has(classname)) {
			return { status: "skipped" } as const;
		}
		const names = classnameCandidates(item);
		// Locally a bundle is either `.hab` (what repairs write) or a legacy
		// `.nitro`; both count as "the asset is already here".
		const fileNames = names.flatMap((n) => bundleFileNames(n));

		const presentDirs = nitroDirs.filter((dir) =>
			fileNames.some((f) => existsSync(getRuntimePath(dir, f))),
		);
		const missingDirs = nitroDirs.filter((dir) => !presentDirs.includes(dir));

		if (missingDirs.length === 0) {
			return { status: "skipped" } as const;
		}

		let ok = false;
		const warnings: string[] = [];

		// 1) Copy across mirrors — the .nitro already exists in one target (e.g.
		// gamedata), so just fill the ones that are missing it.
		if (presentDirs.length > 0) {
			for (const f of fileNames) {
				const src = nitroDirs.find((d) => existsSync(getRuntimePath(d, f)));
				if (!src) continue;
				const dst = missingDirs.filter((d) => d !== src);
				if (dst.length === 0) continue;
				try {
					const copyErrors = await copyNitroAcrossDirs(src, dst, f);
					warnings.push(...copyErrors);
				} catch (err) {
					warnings.push(
						`copy across .nitro dirs failed: ${(err as Error).message}`,
					);
				}
			}
		}

		// 2) Download from configured or default nitro sources.
		if (!ok) {
			let sources: CloneSource[] = [];
			try {
				sources = (await listSources()).filter((s) => s.nitroBaseUrl);
			} catch (err) {
				warnings.push(`listSources failed: ${(err as Error).message}`);
			}
			if (sources.length === 0) sources = DEFAULT_NITRO_SOURCES;

			for (const n of names) {
				const nitroCandidates = [
					n,
					...(n.includes("*") ? [n.split("*")[0], n.replace(/\*/g, "_")] : []),
					...(n.includes(".") ? [n.replace(/\./g, "_")] : []),
				];

				for (const source of sources) {
					for (const nitroName of nitroCandidates) {
						const tmpPath = getRuntimePath(
							os.tmpdir(),
							`.repair_nitro_${classname}_${Math.random().toString(36).slice(2, 8)}.nitro`,
						);
						try {
							const dl = await downloadFile(
								templateUrl(source.nitroBaseUrl, n, n),
								tmpPath,
								{ maxRetries: 1 },
							);
							if (dl.ok) {
								// Validate it is a real Nitro bundle before writing it
								// anywhere (mirrors clone-import.ts).
								const buffer = await fs.readFile(tmpPath);
								parseNitroBundle(buffer);
								// Repaired bundles are stored as `.hab`.
								const writeErrors = await writeNitroToDirs(
									buffer,
									missingDirs,
									`${n}${LOCAL_BUNDLE_EXT}`,
								);
								warnings.push(...writeErrors);
								ok = writeErrors.length === 0;
								break;
							}
							warnings.push(`${nitroName} not found on ${source.name}`);
						} catch (err) {
							warnings.push(
								`download from ${source.name} failed: ${(err as Error).message}`,
							);
						} finally {
							await fs.unlink(tmpPath).catch(() => {});
						}
					}
					if (ok) break;
				}
				if (ok) break;
			}
		}

		if (ok) {
			return { status: "done", warnings } as const;
		}
		return {
			status: "failed",
			message: warnings[0] || "could not obtain a bundle",
		} as const;
	};

	await runPool(items, REPAIR_CONCURRENCY, async (item, i) => {
		const classname = item.item_name;
		const result = await processItem(item);
		if (result.status === "skipped") {
			skipped++;
			onEvent?.({
				type: "progress",
				classname,
				status: "skipped",
				index: i,
				total,
			});
			return;
		}
		if (result.status === "done") {
			succeeded++;
			onEvent?.({
				type: "progress",
				classname,
				status: "done",
				index: i,
				total,
				warnings: result.warnings.length ? result.warnings : undefined,
			});
			return;
		}
		failed++;
		onEvent?.({
			type: "progress",
			classname,
			status: "failed",
			index: i,
			total,
			message: result.message,
		});
	});

	onEvent?.({
		type: "batch_complete",
		succeeded,
		failed,
		skipped,
	});
	return { succeeded, failed, skipped };
}

/** Expand %libname% / %param% templates used by some retro asset mirrors. */
function templateUrl(base: string, libname: string, param: string): string {
	if (!base) return "";
	return base
		.replace(/%libname%/g, encodeURIComponent(libname))
		.replace(/%param%/g, encodeURIComponent(param));
}

/**
 * Re-convert every furniture `.nitro` we produced from a local SWF so the
 * bundles include size 32 (and every other visualization size the converter
 * now emits). Used to backfill size 32 support on already-imported furniture
 * after the converter was changed.
 *
 * Only items that have a local SWF are re-converted: those are the bundles our
 * own converter built (and that may be missing size 32). Source-provided
 * `.nitro` bundles already carry every size, so they are left untouched. The
 * regenerated bundle is validated before it overwrites anything in the nitro
 * directories.
 */

/**
 * Synthesize a size-32 visualization on every existing furniture `.nitro` that
 * does not already have one. The 32 frame is generated by downscaling the
 * largest existing sprite (usually size 64) — no SWF is required, so this works
 * for source-provided bundles too. Each rewritten bundle is validated and
 * written back to every nitro directory (including the live
 * `/var/www/Gamedata/bundled/furniture`). Bundles that already carry a 32 frame
 * (or cannot derive one) are left untouched.
 */
export async function addSize32AllNitros(
	onEvent?: (evt: RepairNitroEvent) => void,
	opts?: { concurrency?: number },
): Promise<{
	succeeded: number;
	failed: number;
	skipped: number;
	existing: number;
}> {
	let succeeded = 0;
	let failed = 0;
	let skipped = 0;

	try {
		await ensureDirectories();
	} catch (err) {
		onEvent?.({
			type: "error",
			message: `ensureDirectories failed: ${(err as Error).message}`,
		});
		return { succeeded, failed, skipped, existing: 0 };
	}

	let targets: FurniAssetWriteTargets;
	try {
		targets = await getFurniAssetWriteTargets();
	} catch (err) {
		onEvent?.({
			type: "error",
			message: `getFurniAssetWriteTargets failed: ${(err as Error).message}`,
		});
		return { succeeded, failed, skipped, existing: 0 };
	}

	const nitroDirs = uniqueDirs([
		targets.nitroDir,
		...targets.mirrorDirs.map((d) => d.nitroDir),
	]);

	// Collect every .nitro we have (across primary + mirrored gamedata dirs),
	// keyed by file name so we process each bundle exactly once.
	const fileNames = new Set<string>();
	for (const dir of nitroDirs) {
		try {
			const names = await fs.readdir(dir);
			for (const n of names) {
				if (stripBundleExt(n) !== null) fileNames.add(n);
			}
		} catch {
			/* ignore unreadable dir */
		}
	}
	const existing = fileNames.size;
	const total = existing;
	onEvent?.({ type: "started", total });

	await runPool(
		[...fileNames],
		opts?.concurrency ?? 12,
		async (fileName, i) => {
			let buf: Buffer | null = null;
			for (const dir of nitroDirs) {
				try {
					buf = await fs.readFile(getRuntimePath(dir, fileName));
					break;
				} catch {
					/* try next dir */
				}
			}
			if (!buf) {
				skipped++;
				onEvent?.({
					type: "progress",
					classname: fileName,
					status: "missing",
					index: i,
					total,
				});
				return;
			}

			let out: Buffer | null;
			try {
				out = await addSize32ToBundle(buf);
			} catch (err) {
				failed++;
				onEvent?.({
					type: "progress",
					classname: fileName,
					status: "convert-failed",
					index: i,
					total,
					message: (err as Error).message,
				});
				return;
			}

			if (!out) {
				skipped++;
				return;
			}

			try {
				const errors = await writeNitroToDirs(out, nitroDirs, fileName);
				if (errors.length > 0) {
					failed++;
					onEvent?.({
						type: "progress",
						classname: fileName,
						status: "write-failed",
						index: i,
						total,
						warnings: errors,
					});
					return;
				}
				succeeded++;
				onEvent?.({
					type: "progress",
					classname: fileName,
					status: "done",
					index: i,
					total,
				});
			} catch (err) {
				failed++;
				onEvent?.({
					type: "progress",
					classname: fileName,
					status: "write-failed",
					index: i,
					total,
					message: (err as Error).message,
				});
			}
		},
	);

	onEvent?.({ type: "batch_complete", succeeded, failed, skipped, existing });

	return { succeeded, failed, skipped, existing };
}
