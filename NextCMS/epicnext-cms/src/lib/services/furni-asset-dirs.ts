import { existsSync } from "node:fs";
import path from "node:path";
import { siteSettings } from "@/lib/services/site-settings";
import { getRuntimePath } from "@/lib/utils/runtime-path";

export const DEFAULT_NITRO_FILES_ROOT = getRuntimePath(
	/*turbopackIgnore: true*/ path.dirname(process.cwd()),
	"DEV",
	"Nitro-Files",
);
export const DEFAULT_GAMEDATA_ROOT =
	process.platform === "win32" ? "" : "/var/www/Gamedata";
export const DEFAULT_FURNI_ICON_DIR = getRuntimePath(
	/*turbopackIgnore: true*/ process.cwd(),
	"public/swf/dcr/hof_furni/icons",
);
export const DEFAULT_FURNI_SWF_DIR = getRuntimePath(
	/*turbopackIgnore: true*/ process.cwd(),
	"public/swf/dcr/hof_furni/swf",
);
export const DEFAULT_FURNI_NITRO_DIR = getRuntimePath(
	/*turbopackIgnore: true*/ process.cwd(),
	"public/nitro-assets/bundled/furniture",
);

export interface FurniAssetDirs {
	swfDir: string;
	iconDir: string;
	nitroDir: string;
}

export interface FurniAssetWriteTargets extends FurniAssetDirs {
	mirrorDirs: FurniAssetDirs[];
}

function normalizeDir(value: string | undefined, fallback: string): string {
	const raw = value?.trim() || fallback;
	let normalized = path.normalize(raw);
	const root = path.parse(normalized).root;
	while (normalized.length > root.length && /[\\/]$/.test(normalized)) {
		normalized = normalized.slice(0, -1);
	}
	return normalized;
}

function uniqueDirs(dirs: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const dir of dirs) {
		const normalized = normalizeDir(dir, dir);
		const key =
			process.platform === "win32" ? normalized.toLowerCase() : normalized;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(normalized);
	}
	return out;
}

export async function getNitroFilesRoot(): Promise<string> {
	const configured = (await siteSettings.get("nitro_files_root", "")) ?? "";
	if (configured.trim()) return normalizeDir(configured, configured);

	return existsSync(/*turbopackIgnore: true*/ DEFAULT_NITRO_FILES_ROOT)
		? normalizeDir(DEFAULT_NITRO_FILES_ROOT, DEFAULT_NITRO_FILES_ROOT)
		: "";
}

export async function getGamedataRoot(): Promise<string> {
	const configured = (await siteSettings.get("gamedata_root", "")) ?? "";
	if (configured.trim()) return normalizeDir(configured, configured);

	return DEFAULT_GAMEDATA_ROOT &&
		existsSync(/*turbopackIgnore: true*/ DEFAULT_GAMEDATA_ROOT)
		? normalizeDir(DEFAULT_GAMEDATA_ROOT, DEFAULT_GAMEDATA_ROOT)
		: "";
}

function dirsFromNitroFilesRoot(root: string): FurniAssetDirs {
	return {
		swfDir: getRuntimePath(/*turbopackIgnore: true*/ root, "swf/dcr/hof_furni"),
		iconDir: getRuntimePath(
			/*turbopackIgnore: true*/ root,
			"swf/dcr/hof_furni/icons",
		),
		nitroDir: getRuntimePath(
			/*turbopackIgnore: true*/ root,
			"nitro-assets/bundled/furniture",
		),
	};
}

function dirsFromGamedataRoot(
	root: string,
	primarySwfDir: string,
): FurniAssetDirs {
	return {
		swfDir: primarySwfDir,
		iconDir: getRuntimePath(/*turbopackIgnore: true*/ root, "icons"),
		nitroDir: getRuntimePath(
			/*turbopackIgnore: true*/ root,
			"bundled/furniture",
		),
	};
}

export async function getFurniAssetDirs(): Promise<FurniAssetDirs> {
	const [swfDir, iconDir, nitroDir] = await Promise.all([
		siteSettings
			.get("furni_swf_dir", DEFAULT_FURNI_SWF_DIR)
			.then((v) => v ?? DEFAULT_FURNI_SWF_DIR),
		siteSettings
			.get("furni_icon_dir", DEFAULT_FURNI_ICON_DIR)
			.then((v) => v ?? DEFAULT_FURNI_ICON_DIR),
		siteSettings
			.get("furni_nitro_dir", DEFAULT_FURNI_NITRO_DIR)
			.then((v) => v ?? DEFAULT_FURNI_NITRO_DIR),
	]);

	return {
		swfDir: normalizeDir(swfDir, DEFAULT_FURNI_SWF_DIR),
		iconDir: normalizeDir(iconDir, DEFAULT_FURNI_ICON_DIR),
		nitroDir: normalizeDir(nitroDir, DEFAULT_FURNI_NITRO_DIR),
	};
}

export async function getFurniAssetWriteTargets(): Promise<FurniAssetWriteTargets> {
	const primary = await getFurniAssetDirs();
	const [nitroFilesRoot, gamedataRoot] = await Promise.all([
		getNitroFilesRoot(),
		getGamedataRoot(),
	]);
	const mirrorCandidates = [
		...(nitroFilesRoot ? [dirsFromNitroFilesRoot(nitroFilesRoot)] : []),
		...(gamedataRoot
			? [dirsFromGamedataRoot(gamedataRoot, primary.swfDir)]
			: []),
	];

	const primaryKey = {
		swfDir:
			process.platform === "win32"
				? primary.swfDir.toLowerCase()
				: primary.swfDir,
		iconDir:
			process.platform === "win32"
				? primary.iconDir.toLowerCase()
				: primary.iconDir,
		nitroDir:
			process.platform === "win32"
				? primary.nitroDir.toLowerCase()
				: primary.nitroDir,
	};

	const seenCandidates = new Set<string>();
	const mirrorDirs = mirrorCandidates.filter((dirs) => {
		const swfDir = normalizeDir(dirs.swfDir, dirs.swfDir);
		const iconDir = normalizeDir(dirs.iconDir, dirs.iconDir);
		const nitroDir = normalizeDir(dirs.nitroDir, dirs.nitroDir);
		const isDifferent =
			(process.platform === "win32" ? swfDir.toLowerCase() : swfDir) !==
				primaryKey.swfDir ||
			(process.platform === "win32" ? iconDir.toLowerCase() : iconDir) !==
				primaryKey.iconDir ||
			(process.platform === "win32" ? nitroDir.toLowerCase() : nitroDir) !==
				primaryKey.nitroDir;
		if (!isDifferent) return false;

		const candidateKey = [swfDir, iconDir, nitroDir]
			.map((dir) => (process.platform === "win32" ? dir.toLowerCase() : dir))
			.join("\0");
		if (seenCandidates.has(candidateKey)) return false;
		seenCandidates.add(candidateKey);
		return true;
	});

	return {
		...primary,
		mirrorDirs: mirrorDirs.map((dirs) => ({
			swfDir: uniqueDirs([dirs.swfDir])[0],
			iconDir: uniqueDirs([dirs.iconDir])[0],
			nitroDir: uniqueDirs([dirs.nitroDir])[0],
		})),
	};
}
