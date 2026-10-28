import { existsSync, promises as fs } from "node:fs";
import {
	bundleExistsInDir,
	bundleWritePathInDir,
	existingBundlePaths,
} from "@/lib/furni/bundle-file";
import {
	listOfficialEffects,
	resolveEffectSwfUrl,
} from "@/lib/services/effect-source";
import {
	listLocalEffects,
	mergeEffect,
	removeEffect,
} from "@/lib/services/effectmap";
import { getGamedataRoot } from "@/lib/services/furni-asset-dirs";
import { downloadFile } from "@/lib/services/import/core/download";
import { siteSettings } from "@/lib/services/site-settings";
import { convertSwfToNitro } from "@/lib/services/swf-to-nitro";
import { getRuntimePath } from "@/lib/utils/runtime-path";
import type {
	EffectListItem,
	EffectMapEntry,
	ImportEffectResult,
} from "@/types/effects";

const EFFECT_NITRO_DIR_FALLBACK = getRuntimePath(
	/*turbopackIgnore: true*/ process.cwd(),
	"public/nitro-assets/bundled/effect",
);
const EFFECT_SWF_DIR_FALLBACK = getRuntimePath(
	/*turbopackIgnore: true*/ process.cwd(),
	"public/swf/gordon",
);

async function getEffectNitroDir(): Promise<string> {
	const configured = (
		(await siteSettings.get("effect_nitro_dir", "")) ?? ""
	).trim();
	if (configured) return configured;
	const gamedataRoot = await getGamedataRoot();
	if (gamedataRoot)
		return getRuntimePath(
			/*turbopackIgnore: true*/ gamedataRoot,
			"bundled/effect",
		);
	return EFFECT_NITRO_DIR_FALLBACK;
}

async function getEffectSwfDir(): Promise<string> {
	const configured = (
		(await siteSettings.get("effect_swf_dir", "")) ?? ""
	).trim();
	return configured || EFFECT_SWF_DIR_FALLBACK;
}

export async function ensureEffectDirs(): Promise<void> {
	const [nitroDir, swfDir] = await Promise.all([
		getEffectNitroDir(),
		getEffectSwfDir(),
	]);
	await Promise.all(
		[nitroDir, swfDir]
			.filter((dir) => !existsSync(/*turbopackIgnore: true*/ dir))
			.map((dir) =>
				fs.mkdir(/*turbopackIgnore: true*/ dir, { recursive: true }),
			),
	);
}

// Imports write `.hab`, the extension the client requests; a bundle still on
// disk as legacy `.nitro` keeps counting as present.
async function nitroPathFor(lib: string): Promise<string> {
	return bundleWritePathInDir(
		/*turbopackIgnore: true*/ await getEffectNitroDir(),
		lib,
	);
}

export async function importSingleEffect(params: {
	id: string;
	lib: string;
	type: string;
	revision: number;
	onProgress?: (status: string) => void;
}): Promise<ImportEffectResult> {
	const { id, lib, type, revision, onProgress } = params;
	// The name becomes part of file paths: letters, digits, "_" and "-" only (no "../").
	if (!/^[A-Za-z0-9_-]{1,200}$/.test(lib)) {
		return { ok: false, lib, warnings: [], error: "Invalid library name" };
	}
	const warnings: string[] = [];
	await ensureEffectDirs();

	const nitroPath = await nitroPathFor(lib);

	// Download SWF
	onProgress?.("downloading");
	const swfPath = getRuntimePath(
		/*turbopackIgnore: true*/ await getEffectSwfDir(),
		`${lib}.swf`,
	);
	let swfUrl: string;
	try {
		swfUrl = await resolveEffectSwfUrl(lib);
	} catch (err) {
		return {
			ok: false,
			lib,
			warnings,
			error: `Could not resolve SWF URL: ${(err as Error).message}`,
		};
	}
	const dl = await downloadFile(swfUrl, swfPath, { validate: "swf" });
	if (!dl.ok)
		return {
			ok: false,
			lib,
			warnings,
			error: `SWF download failed: ${swfUrl}`,
		};

	// Convert SWF → Nitro
	onProgress?.("converting");
	try {
		const swfBuffer = await fs.readFile(/*turbopackIgnore: true*/ swfPath);
		const result = await convertSwfToNitro(swfBuffer, lib);
		await fs.writeFile(/*turbopackIgnore: true*/ nitroPath, result.bundle);
		if (result.warnings?.length) warnings.push(...result.warnings);
	} catch (err) {
		return {
			ok: false,
			lib,
			warnings,
			error: `SWF→Nitro conversion failed: ${(err as Error).message}`,
		};
	}

	// Merge EffectMap.json (last step — no orphan entry if anything above failed)
	onProgress?.("writing_map");
	try {
		const entry: EffectMapEntry = { id, lib, type, revision };
		await mergeEffect(entry);
	} catch (err) {
		warnings.push(`EffectMap.json merge failed: ${(err as Error).message}`);
		return { ok: false, lib, warnings, error: "EffectMap.json merge failed" };
	}

	return { ok: true, lib, warnings };
}

export async function deleteImportedEffect(
	idOrLib: string,
): Promise<{ removed: boolean; deletedFile: boolean }> {
	const local = await listLocalEffects();
	const entry = local.find((e) => e.id === idOrLib || e.lib === idOrLib);
	const removed = await removeEffect(idOrLib);
	let deletedFile = false;
	if (entry) {
		// Clear both conventions so a re-import cannot resurrect a stale bundle.
		const paths = existingBundlePaths(
			[/*turbopackIgnore: true*/ await getEffectNitroDir()],
			entry.lib,
		);
		for (const p of paths) {
			await fs.unlink(/*turbopackIgnore: true*/ p).catch(() => {});
		}
		deletedFile = paths.length > 0;
	}
	return { removed, deletedFile };
}

export async function getEffectList(search: string): Promise<EffectListItem[]> {
	const [official, local, nitroDir] = await Promise.all([
		listOfficialEffects(),
		listLocalEffects(),
		getEffectNitroDir(),
	]);
	// The official Habbo effectmap endpoint is frequently unreachable/dead.
	// Fall back to the locally cached map so the list stays usable.
	const base = official.length > 0 ? official : local;
	const localByLib = new Map(local.map((e) => [e.lib, e]));
	const term = search.trim().toLowerCase();
	const merged = base.map((e) => ({
		...e,
		present: localByLib.has(e.lib),
		nitroExists: bundleExistsInDir(/*turbopackIgnore: true*/ nitroDir, e.lib),
	}));
	return term
		? merged.filter(
				(e) =>
					e.lib.toLowerCase().includes(term) ||
					e.id.toLowerCase().includes(term) ||
					e.type.includes(term),
			)
		: merged;
}

export async function getEffectStats(): Promise<{
	official: number;
	imported: number;
	missing: number;
}> {
	const [official, local] = await Promise.all([
		listOfficialEffects(),
		listLocalEffects(),
	]);
	const localLibs = new Set(local.map((e) => e.lib));
	const imported =
		official.length > 0
			? official.filter((e) => localLibs.has(e.lib)).length
			: localLibs.size;
	return {
		official: official.length > 0 ? official.length : local.length,
		imported,
		missing:
			official.length > 0
				? official.length - imported
				: local.length - imported,
	};
}
