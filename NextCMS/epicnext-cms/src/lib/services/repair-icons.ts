import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import { sql } from "drizzle-orm";
import { queryRows } from "@/lib/db";
import { resolveBundleInDir } from "@/lib/furni/bundle-file";
import { logServerError } from "@/lib/server-log";
import { extractFurniIconPng } from "@/lib/services/clone-icon";
import {
	type CloneSource,
	DEFAULT_ICON_SOURCES,
	listSources,
} from "@/lib/services/clone-sources";
import {
	type FurniAssetWriteTargets,
	getFurniAssetWriteTargets,
	getGamedataRoot,
} from "@/lib/services/furni-asset-dirs";
import { downloadFile } from "@/lib/services/import/core/download";
import { classifyCatalogItem, NO_ASSET_KINDS } from "@/lib/services/item-kind";
import { getRuntimePath } from "@/lib/utils/runtime-path";
import { ensureDirectories } from "./furni-import";

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

async function writeIconToDirs(
	icon: Buffer,
	dirs: string[],
	fileName: string,
): Promise<string[]> {
	const errors: string[] = [];
	for (const dir of dirs) {
		try {
			await fs.mkdir(dir, { recursive: true });
			await fs.writeFile(getRuntimePath(dir, fileName), icon);
		} catch (err) {
			errors.push(`write icon to ${dir} failed: ${(err as Error).message}`);
		}
	}
	return errors;
}

async function copyIconAcrossDirs(
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
			errors.push(`copy icon to ${dir} failed: ${(err as Error).message}`);
		}
	}
	return errors;
}

export interface RepairEvent {
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
	duration?: number;
}

export async function repairMissingIcons(
	onEvent?: (evt: RepairEvent) => void,
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
	// them so both the CMS and the client see the icon.
	const iconDirs = uniqueDirs([
		targets.iconDir,
		...targets.mirrorDirs.map((d) => d.iconDir),
	]);
	const nitroDirs = uniqueDirs([
		targets.nitroDir,
		...targets.mirrorDirs.map((d) => d.nitroDir),
	]);

	// Badges and other special items (pets, effects, bots, sticky notes) never
	// ship furni `_icon.png` files — resolve the skip set from the DB so badge
	// detection is precise (`items_base.type = 'b'`) instead of relying only on
	// which .gif files happen to exist in the album directory.
	let skipSet: Set<string> | null = null;
	try {
		const gamedataRoot = await getGamedataRoot();
		if (gamedataRoot) {
			const badgeFiles = await fs
				.readdir(getRuntimePath(gamedataRoot, "album1584"))
				.catch((error) => {
					logServerError("repair_icons.readdir_album_failed", error);
					return [] as string[];
				});
			const albumBadgeSet = new Set(
				badgeFiles.filter((f) => f.endsWith(".gif")).map((f) => f.slice(0, -4)),
			);
			skipSet = albumBadgeSet;
		}
	} catch {
		skipSet = null;
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
	const dbSkipSet = new Set<string>();
	for (const item of items) {
		if (NO_ASSET_KINDS.has(classifyCatalogItem(item))) {
			dbSkipSet.add(item.item_name);
		}
	}
	for (const code of skipSet ?? []) {
		dbSkipSet.add(code);
	}

	const total = items.length;
	onEvent?.({ type: "started", total });

	// A row can have its real classname in either `item_name` or `public_name`
	// (some hotels swap them or store a display name). Build the candidate
	// classnames to try in order, most specific first.
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
		// .png icon files to repair. Skip them.
		if (dbSkipSet.has(classname)) {
			return { status: "skipped" } as const;
		}
		const names = classnameCandidates(item);
		const fileNameFor = (n: string) => `${n}_icon.png`;
		const fileNames = names.map(fileNameFor);

		// A file is present if ANY candidate name exists in every target.
		const presentDirs = iconDirs.filter((dir) =>
			fileNames.some((f) => existsSync(getRuntimePath(dir, f))),
		);
		const missingDirs = iconDirs.filter((dir) => !presentDirs.includes(dir));

		if (missingDirs.length === 0) {
			return { status: "skipped" } as const;
		}

		let ok = false;
		const warnings: string[] = [];

		// 1) Copy across mirrors — the icon already exists in one target (e.g.
		// gamedata), so just fill the ones that are missing it. Copy all matched
		// files so whichever candidate forms exist are mirrored everywhere.
		if (presentDirs.length > 0) {
			for (const f of fileNames) {
				const src = iconDirs.find((d) => existsSync(getRuntimePath(d, f)));
				if (!src) continue;
				const dst = missingDirs.filter((d) => d !== src);
				if (dst.length === 0) continue;
				try {
					const copyErrors = await copyIconAcrossDirs(src, dst, f);
					warnings.push(...copyErrors);
				} catch (err) {
					warnings.push(
						`copy across icon dirs failed: ${(err as Error).message}`,
					);
				}
			}
		}

		// 2) Extract from a local bundle (checked across every target).
		if (!ok) {
			for (const n of names) {
				let foundNitro = false;
				for (const dir of nitroDirs) {
					const nitroPath = resolveBundleInDir(dir, n);
					if (!nitroPath) continue;
					foundNitro = true;
					try {
						const nitroBuf = await fs.readFile(nitroPath);
						const icon = await extractFurniIconPng(nitroBuf);
						if (icon) {
							const writeErrors = await writeIconToDirs(
								icon,
								missingDirs,
								fileNameFor(n),
							);
							warnings.push(...writeErrors);
							ok = writeErrors.length === 0;
							break;
						}
						warnings.push("no icon asset in .nitro bundle");
					} catch (err) {
						warnings.push(
							`extract from .nitro failed: ${(err as Error).message}`,
						);
					}
					if (ok) break;
				}
				if (ok) break;
				if (!foundNitro) warnings.push(".nitro file not found on disk");
			}
		}

		// 3) Download from configured or default public sources.
		if (!ok) {
			let sources: CloneSource[] = [];
			try {
				sources = (await listSources()).filter(
					(s) => s.iconBaseUrl || s.nitroBaseUrl,
				);
			} catch (err) {
				warnings.push(`listSources failed: ${(err as Error).message}`);
			}
			if (sources.length === 0) sources = DEFAULT_ICON_SOURCES;

			for (const n of names) {
				const iconCandidates = [
					fileNameFor(n),
					...(n.includes("*")
						? [fileNameFor(n.split("*")[0]), fileNameFor(n.replace(/\*/g, "_"))]
						: []),
					...(n.includes(".") ? [fileNameFor(n.replace(/\./g, "_"))] : []),
				];

				for (const source of sources) {
					for (const iconName of iconCandidates) {
						try {
							const dl = await downloadFile(
								templateUrl(
									source.iconBaseUrl,
									n,
									iconName.replace(/_icon\.png$/, ""),
								),
								/*turbopackIgnore: true*/ getRuntimePath(
									targets.iconDir,
									fileNameFor(n),
								),
								{ maxRetries: 1, validate: "png" },
							);
							if (dl.ok) {
								const icon = await fs.readFile(
									/*turbopackIgnore: true*/ getRuntimePath(
										targets.iconDir,
										fileNameFor(n),
									),
								);
								const writeErrors = await writeIconToDirs(
									icon,
									missingDirs,
									fileNameFor(n),
								);
								warnings.push(...writeErrors);
								ok = writeErrors.length === 0;
								break;
							}
							warnings.push(`${iconName} not found on ${source.name}`);
						} catch (err) {
							warnings.push(
								`download from ${source.name} failed: ${(err as Error).message}`,
							);
						}
					}
					if (ok) break;

					// Some sources only ship icons embedded in their `.nitro` bundles —
					// grab the bundle and extract the catalog icon from it.
					if (source.nitroBaseUrl) {
						const nitroTmp = getRuntimePath(
							os.tmpdir(),
							`.repair_${classname}.nitro`,
						);
						let wroteTmp = false;
						try {
							const dl = await downloadFile(
								templateUrl(source.nitroBaseUrl, n, n),
								nitroTmp,
								{ maxRetries: 1 },
							);
							wroteTmp = dl.ok;
							if (dl.ok) {
								const icon = await extractFurniIconPng(
									await fs.readFile(nitroTmp),
								);
								if (icon) {
									const writeErrors = await writeIconToDirs(
										icon,
										missingDirs,
										fileNameFor(n),
									);
									warnings.push(...writeErrors);
									ok = writeErrors.length === 0;
								} else {
									warnings.push(
										`no icon asset in ${source.name} .nitro bundle`,
									);
								}
							} else {
								warnings.push(`.nitro not found on ${source.name}`);
							}
						} catch (err) {
							warnings.push(
								`extract from ${source.name} .nitro failed: ${(err as Error).message}`,
							);
						} finally {
							if (wroteTmp) {
								await fs
									.unlink(nitroTmp)
									.catch((error) =>
										logServerError("repair_icons.cleanup_failed", error),
									);
							}
						}
						if (ok) break;
					}
				}
				if (ok) break;
			}
		}

		if (ok) {
			return { status: "done", warnings } as const;
		}
		return {
			status: "failed",
			message: warnings[0] || "could not obtain icon",
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
