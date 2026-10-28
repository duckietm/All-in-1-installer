import { existsSync, promises as fs } from "node:fs";
import {
	bundleExistsInDir,
	bundleWritePathInDir,
	existingBundlePaths,
} from "@/lib/furni/bundle-file";
import { downloadFile } from "@/lib/services/import/core/download";
import { CANONICAL_PETS, resolvePetSwfUrl } from "@/lib/services/pet-source";
import { convertSwfToNitro } from "@/lib/services/swf-to-nitro";
import { getRuntimePath } from "@/lib/utils/runtime-path";

export interface PetListItem {
	lib: string;
	nitroExists: boolean;
}

export interface ImportPetResult {
	ok: boolean;
	lib: string;
	warnings: string[];
	error?: string;
}

export const PET_NITRO_DIR = getRuntimePath(
	/*turbopackIgnore: true*/ process.cwd(),
	"public/nitro-assets/bundled/pet",
);
export const PET_SWF_DIR = getRuntimePath(
	/*turbopackIgnore: true*/ process.cwd(),
	"public/swf/gordon",
);

export async function ensurePetDirs(): Promise<void> {
	await Promise.all(
		[PET_NITRO_DIR, PET_SWF_DIR]
			.filter((dir) => !existsSync(/*turbopackIgnore: true*/ dir))
			.map((dir) =>
				fs.mkdir(/*turbopackIgnore: true*/ dir, { recursive: true }),
			),
	);
}

// Imports write `.hab`, the extension the client requests. A pet whose bundle
// predates that (`.nitro`) still counts as imported until it is re-imported.
function nitroPathFor(lib: string): string {
	return bundleWritePathInDir(/*turbopackIgnore: true*/ PET_NITRO_DIR, lib);
}

function petBundleExists(lib: string): boolean {
	return bundleExistsInDir(/*turbopackIgnore: true*/ PET_NITRO_DIR, lib);
}

export async function importSinglePet(params: {
	lib: string;
	onProgress?: (status: string) => void;
}): Promise<ImportPetResult> {
	const { lib, onProgress } = params;
	const warnings: string[] = [];
	await ensurePetDirs();

	onProgress?.("downloading");
	const swfPath = getRuntimePath(
		/*turbopackIgnore: true*/ PET_SWF_DIR,
		`${lib}.swf`,
	);
	let swfUrl: string;
	try {
		swfUrl = await resolvePetSwfUrl(lib);
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
			/*turbopackIgnore: true*/ nitroPathFor(lib),
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

export async function deleteImportedPet(
	lib: string,
): Promise<{ deletedFile: boolean }> {
	// Remove both conventions so a re-import cannot resurrect a stale bundle.
	const paths = existingBundlePaths(
		[/*turbopackIgnore: true*/ PET_NITRO_DIR],
		lib,
	);
	if (paths.length === 0) return { deletedFile: false };
	for (const p of paths) {
		await fs.unlink(/*turbopackIgnore: true*/ p).catch(() => {});
	}
	return { deletedFile: true };
}

export function getPetList(search: string): PetListItem[] {
	const term = search.trim().toLowerCase();
	const list = CANONICAL_PETS.map((lib) => ({
		lib,
		nitroExists: petBundleExists(lib),
	}));
	return term ? list.filter((p) => p.lib.toLowerCase().includes(term)) : list;
}

export function getPetStats(): {
	total: number;
	imported: number;
	missing: number;
} {
	const imported = CANONICAL_PETS.filter((lib) => petBundleExists(lib)).length;
	return {
		total: CANONICAL_PETS.length,
		imported,
		missing: CANONICAL_PETS.length - imported,
	};
}
