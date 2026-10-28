import { resolveGamedataFile } from "@/lib/services/import/core/asset-paths";
import {
	readGamedataJson,
	withGamedataLock,
	writeGamedataJsonAtomic,
} from "@/lib/services/import/core/gamedata-json";
import { siteSettings } from "@/lib/services/site-settings";
import type { EffectMapEntry } from "@/types/effects";

interface EffectMapFile {
	effects: EffectMapEntry[];
}

// Test seam: allows the suite to point the resolver at a temp file.
let pathOverride: string | null = null;
export function __setEffectMapPathForTests(p: string | null): void {
	pathOverride = p;
}

export async function getEffectMapPath(): Promise<string> {
	if (pathOverride) return pathOverride;
	const url = await siteSettings.get(
		"effectmap_url",
		"/nitro-assets/gamedata/EffectMap.json",
	);
	return await resolveGamedataFile(
		url ?? "/nitro-assets/gamedata/EffectMap.json",
		"EffectMap.json",
	);
}

export async function readEffectMap(): Promise<EffectMapFile> {
	const file = await getEffectMapPath();
	const data = await readGamedataJson<Partial<EffectMapFile>>(file);
	return { effects: Array.isArray(data.effects) ? data.effects : [] };
}

export async function listLocalEffects(): Promise<EffectMapEntry[]> {
	return (await readEffectMap()).effects;
}

export async function mergeEffect(entry: EffectMapEntry): Promise<void> {
	const file = await getEffectMapPath();
	await withGamedataLock(file, async () => {
		const data = await readGamedataJson<Partial<EffectMapFile>>(file);
		const effects = Array.isArray(data.effects) ? data.effects : [];
		const idx = effects.findIndex((e) => e.id === entry.id);
		if (idx >= 0) effects[idx] = entry;
		else effects.push(entry);
		await writeGamedataJsonAtomic(file, { ...data, effects });
	});
}

export async function removeEffect(idOrLib: string): Promise<boolean> {
	const file = await getEffectMapPath();
	return withGamedataLock(file, async () => {
		const data = await readGamedataJson<Partial<EffectMapFile>>(file);
		const effects = Array.isArray(data.effects) ? data.effects : [];
		const next = effects.filter((e) => e.id !== idOrLib && e.lib !== idOrLib);
		const removed = next.length < effects.length;
		if (removed)
			await writeGamedataJsonAtomic(file, { ...data, effects: next });
		return removed;
	});
}
