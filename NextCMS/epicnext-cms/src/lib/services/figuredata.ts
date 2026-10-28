import { resolveGamedataFile } from "@/lib/services/import/core/asset-paths";
import {
	readGamedataJson,
	withGamedataLock,
	writeGamedataJsonAtomic,
} from "@/lib/services/import/core/gamedata-json";
import { siteSettings } from "@/lib/services/site-settings";

interface FdSet {
	id: number;
	[k: string]: unknown;
}
interface FdSetType {
	type: string;
	paletteId: number;
	sets: FdSet[];
	[k: string]: unknown;
}
interface FdPalette {
	id: number;
	colors: unknown[];
}
interface FigureDataFile {
	palettes: FdPalette[];
	setTypes: FdSetType[];
}

const pathOverride: string | null = null;

export async function getFigureDataPath(): Promise<string> {
	if (pathOverride) return pathOverride;
	const url = await siteSettings.get(
		"figuredata_url",
		"/nitro-assets/gamedata/FigureData.json",
	);
	return await resolveGamedataFile(
		url ?? "/nitro-assets/gamedata/FigureData.json",
		"FigureData.json",
	);
}

export async function readFigureData(): Promise<FigureDataFile> {
	const data = await readGamedataJson<Partial<FigureDataFile>>(
		await getFigureDataPath(),
	);
	return { palettes: data.palettes ?? [], setTypes: data.setTypes ?? [] };
}

export async function listLocalSetIds(setType: string): Promise<Set<number>> {
	const fd = await readFigureData();
	const st = fd.setTypes.find((s) => s.type === setType);
	return new Set((st?.sets ?? []).map((s) => s.id));
}

export async function mergeSet(
	setType: string,
	paletteId: number,
	set: FdSet,
): Promise<void> {
	const file = await getFigureDataPath();
	await withGamedataLock(file, async () => {
		const fd = await readGamedataJson<FigureDataFile>(file);
		fd.setTypes ??= [];
		let st = fd.setTypes.find((s) => s.type === setType);
		if (!st) {
			st = { type: setType, paletteId, sets: [] };
			fd.setTypes.push(st);
		}
		st.sets ??= [];
		const idx = st.sets.findIndex((s) => s.id === set.id);
		if (idx >= 0) {
			st.sets[idx] = set;
		} else {
			st.sets.push(set);
		}
		await writeGamedataJsonAtomic(file, fd);
	});
}

export async function mergePalette(palette: FdPalette): Promise<void> {
	const file = await getFigureDataPath();
	await withGamedataLock(file, async () => {
		const fd = await readGamedataJson<FigureDataFile>(file);
		fd.palettes ??= [];
		if (!fd.palettes.some((p) => p.id === palette.id)) {
			fd.palettes.push(palette);
			await writeGamedataJsonAtomic(file, fd);
		}
	});
}
