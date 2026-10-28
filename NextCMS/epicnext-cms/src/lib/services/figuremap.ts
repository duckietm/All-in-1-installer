import { resolveGamedataFile } from "@/lib/services/import/core/asset-paths";
import {
	readGamedataJson,
	withGamedataLock,
	writeGamedataJsonAtomic,
} from "@/lib/services/import/core/gamedata-json";
import { siteSettings } from "@/lib/services/site-settings";

export interface FigureLibrary {
	id: string;
	revision: number;
	parts?: Array<{ id: number; type: string }>;
}

interface FigureMapFile {
	libraries: FigureLibrary[];
}

let pathOverride: string | null = null;
export function __setFigureMapPathForTests(p: string | null): void {
	pathOverride = p;
}

export async function getFigureMapPath(): Promise<string> {
	if (pathOverride) return pathOverride;
	const url = await siteSettings.get(
		"figuremap_url",
		"/nitro-assets/gamedata/FigureMap.json",
	);
	return await resolveGamedataFile(
		url ?? "/nitro-assets/gamedata/FigureMap.json",
		"FigureMap.json",
	);
}

export async function listFigureLibraries(): Promise<FigureLibrary[]> {
	const file = await getFigureMapPath();
	const data = await readGamedataJson<Partial<FigureMapFile>>(file);
	return Array.isArray(data.libraries) ? data.libraries : [];
}

export async function mergeLibrary(lib: FigureLibrary): Promise<void> {
	const file = await getFigureMapPath();
	await withGamedataLock(file, async () => {
		const data = await readGamedataJson<{ libraries?: FigureLibrary[] }>(file);
		const libraries = Array.isArray(data.libraries) ? data.libraries : [];
		const idx = libraries.findIndex((l) => l.id === lib.id);
		if (idx >= 0) {
			libraries[idx] = lib;
		} else {
			libraries.push(lib);
		}
		await writeGamedataJsonAtomic(file, { ...data, libraries });
	});
}
