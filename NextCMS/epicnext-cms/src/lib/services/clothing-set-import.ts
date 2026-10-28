import {
	ensureFigureDirs,
	importSingleFigure,
} from "@/lib/services/figure-import";
import {
	fetchOfficialFigureData,
	fetchOfficialFigureMap,
	type OfficialFigureData,
	type OfficialLibrary,
	type OfficialSet,
} from "@/lib/services/figure-official";
import {
	listLocalSetIds,
	mergePalette,
	mergeSet,
} from "@/lib/services/figuredata";
import { listFigureLibraries, mergeLibrary } from "@/lib/services/figuremap";

export interface ClothingSetItem {
	setType: string;
	setId: number;
	gender: string;
	club: number;
	sellable: boolean;
	present: boolean;
}

export interface ClothingSetListResult {
	items: ClothingSetItem[];
	meta: { page: number; perPage: number; total: number };
}

export interface ClothingSetStats {
	total: number;
	present: number;
	missing: number;
}

export interface ImportClothingSetResult {
	ok: boolean;
	setId?: number;
	warnings: string[];
	error?: string;
}

function partKey(type: string, id: number): string {
	return `${type}:${id}`;
}

function buildPartIndex(
	officialLibs: OfficialLibrary[],
): Map<string, OfficialLibrary> {
	const index = new Map<string, OfficialLibrary>();
	for (const lib of officialLibs) {
		for (const part of lib.parts) {
			const key = partKey(part.type, part.id);
			if (!index.has(key)) {
				index.set(key, lib);
			}
		}
	}
	return index;
}

function mapOfficialSet(set: OfficialSet): Record<string, unknown> {
	const result: Record<string, unknown> = {
		id: set.id,
		gender: set.gender,
		club: set.club,
		colorable: set.colorable,
		selectable: set.selectable,
		preselectable: set.preselectable,
		sellable: set.sellable,
		parts: set.parts.map((p) => ({
			id: p.id,
			type: p.type,
			colorable: p.colorable,
			index: p.index,
			colorindex: p.colorindex,
		})),
	};
	if (set.hiddenLayers?.length) {
		result.hiddenLayers = set.hiddenLayers;
	}
	return result;
}

export async function importClothingSet(params: {
	setType: string;
	setId: number;
	onProgress?: (status: string) => void;
}): Promise<ImportClothingSetResult> {
	const { setType, setId, onProgress } = params;
	const warnings: string[] = [];

	const [officialFd, officialLibs] = await Promise.all([
		fetchOfficialFigureData(),
		fetchOfficialFigureMap(),
	]);

	const st = officialFd.setTypes.find((s) => s.type === setType);
	if (!st) {
		return {
			ok: false,
			warnings,
			error: `setType "${setType}" not found in official figuredata`,
		};
	}
	const set = st.sets.find((s) => s.id === setId);
	if (!set) {
		return {
			ok: false,
			warnings,
			error: `set id ${setId} not found in setType "${setType}" in official figuredata`,
		};
	}

	const palette = officialFd.palettes.find((p) => p.id === st.paletteId);

	const partIndex = buildPartIndex(officialLibs);
	const requiredLibIds = new Set<string>();
	for (const part of set.parts) {
		const lib = partIndex.get(partKey(part.type, part.id));
		if (lib) {
			requiredLibIds.add(lib.id);
		} else {
			warnings.push(`No library found for part ${part.type}:${part.id}`);
		}
	}

	const localLibs = await listFigureLibraries();
	const localLibIds = new Set(localLibs.map((l) => l.id));

	await ensureFigureDirs();

	let hardFail = false;

	for (const libId of requiredLibIds) {
		const officialLib = officialLibs.find((l) => l.id === libId);
		if (!officialLib) continue;

		if (!localLibIds.has(libId)) {
			onProgress?.(`importing library ${libId}`);
			const result = await importSingleFigure({ lib: libId, onProgress });
			if (!result.ok) {
				hardFail = true;
				warnings.push(
					`Library import failed for ${libId}: ${result.error ?? "unknown error"}`,
				);
				continue;
			}
			if (result.warnings.length) {
				warnings.push(...result.warnings);
			}
			localLibIds.add(libId);
		}

		await mergeLibrary(officialLib);
	}

	if (hardFail) {
		return {
			ok: false,
			setId,
			warnings,
			error:
				"One or more required figure libraries failed to import — set was not written",
		};
	}

	const mappedSet = mapOfficialSet(set);
	await mergeSet(setType, st.paletteId, mappedSet as never);

	if (palette) {
		await mergePalette(palette as never);
	}

	return { ok: true, setId, warnings };
}

export async function getClothingSetList(params: {
	search: string;
	page: number;
	perPage: number;
	setType?: string;
}): Promise<ClothingSetListResult> {
	const { search, page, perPage, setType } = params;

	const officialFd: OfficialFigureData = await fetchOfficialFigureData();

	const allItems: ClothingSetItem[] = [];
	for (const st of officialFd.setTypes) {
		if (setType && st.type !== setType) continue;
		const presentIds = await listLocalSetIds(st.type);
		for (const set of st.sets) {
			allItems.push({
				setType: st.type,
				setId: set.id,
				gender: set.gender,
				club: set.club,
				sellable: set.sellable,
				present: presentIds.has(set.id),
			});
		}
	}

	const term = search.trim().toLowerCase();
	const filtered = term
		? allItems.filter(
				(it) =>
					String(it.setId).includes(term) ||
					it.setType.toLowerCase().includes(term),
			)
		: allItems;

	const total = filtered.length;
	const start = (Math.max(page, 1) - 1) * perPage;
	const items = filtered.slice(start, start + perPage);

	return { items, meta: { page: Math.max(page, 1), perPage, total } };
}

export async function getClothingSetStats(): Promise<ClothingSetStats> {
	const officialFd: OfficialFigureData = await fetchOfficialFigureData();

	let total = 0;
	let present = 0;

	for (const st of officialFd.setTypes) {
		const presentIds = await listLocalSetIds(st.type);
		total += st.sets.length;
		present += st.sets.filter((s) => presentIds.has(s.id)).length;
	}

	return { total, present, missing: total - present };
}
