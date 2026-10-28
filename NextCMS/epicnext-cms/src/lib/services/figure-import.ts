import { existsSync, promises as fs } from "node:fs";
import {
	bundleExistsInDir,
	bundleWritePathInDir,
	existingBundlePaths,
} from "@/lib/furni/bundle-file";
import { logServerError } from "@/lib/server-log";
import { resolveFigureSwfUrl } from "@/lib/services/figure-source";
import { listFigureLibraries } from "@/lib/services/figuremap";
import { getGamedataRoot } from "@/lib/services/furni-asset-dirs";
import { downloadFile } from "@/lib/services/import/core/download";
import { siteSettings } from "@/lib/services/site-settings";
import { convertSwfToNitro } from "@/lib/services/swf-to-nitro";
import { getRuntimePath } from "@/lib/utils/runtime-path";

export interface FigureListItem {
	lib: string;
	revision: number;
	nitroExists: boolean;
	// First part the library provides ({type,id}) — used to render an avatar
	// preview wearing it. Undefined if the library declares no parts.
	previewType?: string;
	previewId?: number;
}

export interface ImportFigureResult {
	ok: boolean;
	lib: string;
	warnings: string[];
	error?: string;
}

const FIGURE_NITRO_DIR_FALLBACK = getRuntimePath(
	/*turbopackIgnore: true*/ process.cwd(),
	"public/nitro-assets/bundled/figure",
);
const FIGURE_SWF_DIR_FALLBACK = getRuntimePath(
	/*turbopackIgnore: true*/ process.cwd(),
	"public/swf/gordon",
);

async function getFigureNitroDir(): Promise<string> {
	const configured = (
		(await siteSettings.get("figure_nitro_dir", "")) ?? ""
	).trim();
	if (configured) return configured;
	const gamedataRoot = await getGamedataRoot();
	if (gamedataRoot)
		return getRuntimePath(
			/*turbopackIgnore: true*/ gamedataRoot,
			"bundled/figure",
		);
	return FIGURE_NITRO_DIR_FALLBACK;
}

async function getFigureSwfDir(): Promise<string> {
	const configured = (
		(await siteSettings.get("figure_swf_dir", "")) ?? ""
	).trim();
	return configured || FIGURE_SWF_DIR_FALLBACK;
}

export async function ensureFigureDirs(): Promise<void> {
	const [nitroDir, swfDir] = await Promise.all([
		getFigureNitroDir(),
		getFigureSwfDir(),
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
		/*turbopackIgnore: true*/ await getFigureNitroDir(),
		lib,
	);
}

export async function importSingleFigure(params: {
	lib: string;
	onProgress?: (status: string) => void;
}): Promise<ImportFigureResult> {
	const { lib, onProgress } = params;
	const warnings: string[] = [];
	await ensureFigureDirs();

	onProgress?.("downloading");
	const swfPath = getRuntimePath(
		/*turbopackIgnore: true*/ await getFigureSwfDir(),
		`${lib}.swf`,
	);
	let swfUrl: string;
	try {
		swfUrl = await resolveFigureSwfUrl(lib);
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

	onProgress?.("converting");
	try {
		const swfBuffer = await fs.readFile(/*turbopackIgnore: true*/ swfPath);
		const result = await convertSwfToNitro(swfBuffer, lib);
		await fs.writeFile(
			/*turbopackIgnore: true*/ await nitroPathFor(lib),
			result.bundle,
		);
		if (result.warnings?.length) warnings.push(...result.warnings);
	} catch (err) {
		return {
			ok: false,
			lib,
			warnings,
			error: `SWF→Nitro conversion failed: ${(err as Error).message}`,
		};
	}

	return { ok: true, lib, warnings };
}

export async function deleteImportedFigure(
	lib: string,
): Promise<{ deletedFile: boolean }> {
	// Clear both conventions so a re-import cannot resurrect a stale bundle.
	const paths = existingBundlePaths(
		[/*turbopackIgnore: true*/ await getFigureNitroDir()],
		lib,
	);
	if (paths.length === 0) return { deletedFile: false };
	for (const p of paths) {
		await fs
			.unlink(/*turbopackIgnore: true*/ p)
			.catch((error) => logServerError("figure.delete_failed", error, { lib }));
	}
	return { deletedFile: true };
}

export async function getFigureList(params: {
	search: string;
	page: number;
	perPage: number;
}): Promise<{
	items: FigureListItem[];
	meta: { page: number; perPage: number; total: number };
}> {
	const { search, page, perPage } = params;
	const libs = await listFigureLibraries();
	const term = search.trim().toLowerCase();
	const filtered = term
		? libs.filter((l) => l.id.toLowerCase().includes(term))
		: libs;
	const total = filtered.length;
	const start = (Math.max(page, 1) - 1) * perPage;
	const nitroDir = await getFigureNitroDir();
	const items = filtered.slice(start, start + perPage).map((l) => ({
		lib: l.id,
		revision: l.revision,
		nitroExists: bundleExistsInDir(/*turbopackIgnore: true*/ nitroDir, l.id),
		previewType: l.parts?.[0]?.type,
		previewId: l.parts?.[0]?.id,
	}));
	return { items, meta: { page: Math.max(page, 1), perPage, total } };
}

export async function getFigureStats(): Promise<{
	total: number;
	imported: number;
	missing: number;
}> {
	const [libs, nitroDir] = await Promise.all([
		listFigureLibraries(),
		getFigureNitroDir(),
	]);
	const imported = libs.filter((l) =>
		bundleExistsInDir(/*turbopackIgnore: true*/ nitroDir, l.id),
	).length;
	return { total: libs.length, imported, missing: libs.length - imported };
}
