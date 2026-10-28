/**
 * Pure, side-effect-free helpers for building localized FurnitureData files.
 *
 * This module deliberately imports NOTHING from site-settings / server-only /
 * network so it can run safely inside a worker thread. All I/O (fetching
 * official Habbo translations, calling LibreTranslate, writing files) stays on
 * the main thread; this module only does the CPU-heavy clone + scan + stringify.
 */
import type { HabboGamedataHotel } from "@/lib/habbo-gamedata-hotel";

export type Translation = { name: string; description: string };

export type FurniDataEntry = Record<string, unknown>;
export interface FurniDataSection {
	furnitype: FurniDataEntry[];
}
export type FurniDataMaster = Record<string, FurniDataSection>;

export function cloneFurniData(data: Record<string, unknown>): FurniDataMaster {
	// Deep clone via JSON — structure is pure JSON and 100k+ entries; this is the
	// simplest safe copy so each language build gets its own mutable copy.
	return JSON.parse(JSON.stringify(data)) as FurniDataMaster;
}

export function officialIsRealTranslation(
	lang: string,
	hotel: HabboGamedataHotel,
): boolean {
	// A language mapped to hotel "com" only carries English names, so it must NOT
	// be treated as a real translation — fall through to LibreTranslate for those.
	return lang === "en" || hotel !== "com";
}

export function lookupTranslation(
	map: Map<string, Translation>,
	classname: string,
): Translation | undefined {
	const exact = map.get(classname);
	if (exact) return exact;
	if (classname.includes("*")) {
		const base = classname.split("*")[0];
		const v0 = map.get(`${base}*0`);
		if (v0) return v0;
		const baseExact = map.get(base);
		if (baseExact) return baseExact;
	}
	if (!classname.includes("*")) {
		const v0 = map.get(`${classname}*0`);
		if (v0) return v0;
	}
	return undefined;
}

export interface PendingRef {
	entry: FurniDataEntry;
	field: "name" | "description";
	section: "roomitemtypes" | "wallitemtypes";
}

export interface PreparedLang {
	cloned: FurniDataMaster;
	pendingRefs: PendingRef[];
	pendingTexts: string[];
}

/**
 * Pass 1: deep-clone the master, apply official translations directly, and
 * collect the texts that still need LibreTranslate. Returns the cloned object
 * plus the pending refs/texts so the (network) translation step can run and the
 * result be applied later without re-scanning.
 */
export function prepareLangFile(
	master: FurniDataMaster,
	lang: string,
	hotel: HabboGamedataHotel,
	officialMap: Map<string, Translation>,
): PreparedLang {
	const cloned = cloneFurniData(master);
	const officialIsReal = officialIsRealTranslation(lang, hotel);
	const pendingRefs: PendingRef[] = [];
	const pendingTexts = new Set<string>();

	for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
		for (const entry of cloned[section]?.furnitype ?? []) {
			const cn = typeof entry.classname === "string" ? entry.classname : "";
			if (!cn) continue;
			const t = lookupTranslation(officialMap, cn);
			if (officialIsReal && t?.name) {
				entry.name = t.name;
			} else if (
				lang !== "en" &&
				typeof entry.name === "string" &&
				entry.name.trim()
			) {
				pendingTexts.add(entry.name.trim());
				pendingRefs.push({ entry, field: "name", section });
			}
			if (officialIsReal && t?.description) {
				entry.description = t.description;
			} else if (
				lang !== "en" &&
				typeof entry.description === "string" &&
				entry.description.trim()
			) {
				pendingTexts.add(entry.description.trim());
				pendingRefs.push({ entry, field: "description", section });
			}
		}
	}

	return { cloned, pendingRefs, pendingTexts: [...pendingTexts] };
}

export interface FinalizedLang {
	json: string;
	translatedRoom: number;
	translatedWall: number;
	total: number;
}

/**
 * Pass 2: apply the LibreTranslate results to the prepared clone and serialize
 * it. Kept separate from prepareLangFile so the (async, network) translation
 * step can run in between on the main thread.
 */
export function finalizeLangFile(
	cloned: FurniDataMaster,
	pendingRefs: PendingRef[],
	translations: Map<string, string>,
): FinalizedLang {
	const counted = new Set<FurniDataEntry>();
	let translatedRoom = 0;
	let translatedWall = 0;
	for (const ref of pendingRefs) {
		const original = ref.entry[ref.field];
		if (typeof original !== "string") continue;
		const translated = translations.get(original.trim());
		if (translated === undefined || translated === original) continue;
		ref.entry[ref.field] = translated;
		if (!counted.has(ref.entry)) {
			counted.add(ref.entry);
			if (ref.section === "roomitemtypes") translatedRoom++;
			else translatedWall++;
		}
	}
	const total =
		(cloned.roomitemtypes?.furnitype?.length ?? 0) +
		(cloned.wallitemtypes?.furnitype?.length ?? 0);
	return {
		json: JSON.stringify(cloned),
		translatedRoom,
		translatedWall,
		total,
	};
}

/* ------------------------------------------------------------------ */
/* Localized patch (single-item import path)                           */
/* ------------------------------------------------------------------ */

export interface PatchEntry {
	classname: string;
	name?: string;
	description?: string;
}

interface PatchRef {
	entry: FurniDataEntry;
	field: "name" | "description";
}

interface PatchNewItem {
	section: "roomitemtypes" | "wallitemtypes";
	found: FurniDataEntry;
	name?: string;
	description?: string;
	translateName: boolean;
	translateDesc: boolean;
}

export interface PreparedPatch {
	data: FurniDataMaster;
	refs: PatchRef[];
	newItems: PatchNewItem[];
	pendingTexts: Set<string>;
	officialPatched: number;
}

function findEntryInFurniData(
	data: FurniDataMaster,
	classname: string,
): {
	entry: FurniDataEntry;
	section: "roomitemtypes" | "wallitemtypes";
} | null {
	for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
		const hit = data[section]?.furnitype.find((e) => e.classname === classname);
		if (hit) return { entry: hit, section };
	}
	return null;
}

/**
 * Pass 1 of a localized patch: load the existing language file (or clone the
 * master when it does not exist yet), touch ONLY the wanted classnames, and
 * collect the texts that still need LibreTranslate. The official-vs-Libre
 * decision, master clone and the full file scan all run here (CPU-heavy) so the
 * network translation step can run afterwards on the main thread.
 */
export function preparePatch(
	fileContent: string | null,
	master: FurniDataMaster,
	lang: string,
	hotel: HabboGamedataHotel,
	officialMap: Map<string, Translation>,
	entries: PatchEntry[],
): PreparedPatch {
	const officialIsReal = officialIsRealTranslation(lang, hotel);
	let data: FurniDataMaster;
	try {
		data = fileContent
			? (JSON.parse(fileContent) as FurniDataMaster)
			: cloneFurniData(master);
		if (!fileContent && officialIsReal) {
			for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
				for (const entry of data[section]?.furnitype ?? []) {
					const cn = typeof entry.classname === "string" ? entry.classname : "";
					if (!cn) continue;
					const t = lookupTranslation(officialMap, cn);
					if (t?.name) entry.name = t.name;
					if (t?.description) entry.description = t.description;
				}
			}
		}
	} catch {
		data = cloneFurniData(master);
	}

	const wanted = new Map(entries.map((e) => [e.classname, e]));
	const wantedSet = new Set(wanted.keys());
	const refs: PatchRef[] = [];
	const pendingTexts = new Set<string>();
	let officialPatched = 0;

	for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
		for (const entry of data[section]?.furnitype ?? []) {
			const cn = typeof entry.classname === "string" ? entry.classname : "";
			if (!cn || !wantedSet.has(cn)) continue;
			const wantedEntry = wanted.get(cn);
			if (!wantedEntry) continue;
			const t = lookupTranslation(officialMap, cn);
			const origName =
				wantedEntry.name ?? (typeof entry.name === "string" ? entry.name : "");
			const origDesc =
				wantedEntry.description ??
				(typeof entry.description === "string" ? entry.description : "");
			let didPatch = false;
			if (officialIsReal && t?.name) {
				entry.name = t.name;
				didPatch = true;
			} else if (lang !== "en" && origName) {
				pendingTexts.add(origName);
				refs.push({ entry, field: "name" });
			}
			if (officialIsReal && t?.description) {
				entry.description = t.description;
				didPatch = true;
			} else if (lang !== "en" && origDesc) {
				pendingTexts.add(origDesc);
				refs.push({ entry, field: "description" });
			}
			if (didPatch) officialPatched++;
		}
	}

	// New classnames not yet in the file: copy from master with translation applied.
	const existingClassnames = new Set<string>();
	for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
		for (const e of data[section]?.furnitype ?? []) {
			const cn = typeof e?.classname === "string" ? e.classname : "";
			if (cn) existingClassnames.add(cn);
		}
	}
	const newItems: PatchNewItem[] = [];
	const newTexts = new Set<string>();
	for (const { classname, name, description } of entries) {
		if (existingClassnames.has(classname)) continue;
		const found = findEntryInFurniData(master, classname);
		if (!found) continue;
		const t = lookupTranslation(officialMap, classname);
		const srcName =
			name ?? (typeof found.entry.name === "string" ? found.entry.name : "");
		const srcDesc =
			description ??
			(typeof found.entry.description === "string"
				? found.entry.description
				: "");
		let finalName: string | undefined;
		let finalDesc: string | undefined;
		let translateName = false;
		let translateDesc = false;
		if (officialIsReal && t?.name) finalName = t.name;
		else if (lang !== "en" && srcName) {
			finalName = srcName;
			translateName = true;
			newTexts.add(srcName);
		} else finalName = srcName;
		if (officialIsReal && t?.description) finalDesc = t.description;
		else if (lang !== "en" && srcDesc) {
			finalDesc = srcDesc;
			translateDesc = true;
			newTexts.add(srcDesc);
		} else finalDesc = srcDesc;
		newItems.push({
			section: found.section,
			found: found.entry,
			name: finalName,
			description: finalDesc,
			translateName,
			translateDesc,
		});
	}
	for (const tx of newTexts) pendingTexts.add(tx);

	return { data, refs, newItems, pendingTexts, officialPatched };
}

export interface FinalizedPatch {
	json: string;
	patched: number;
	added: number;
	total: number;
}

/**
 * Pass 2 of a localized patch: apply the (network) LibreTranslate results to the
 * prepared clone and serialize it. New items are appended from the master copy.
 */
export function finalizePatch(
	prepared: PreparedPatch,
	translations: Map<string, string>,
): FinalizedPatch {
	const { data, refs, newItems, officialPatched } = prepared;

	const counted = new Set<FurniDataEntry>();
	let librePatched = 0;
	for (const ref of refs) {
		const original = ref.entry[ref.field];
		if (typeof original !== "string") continue;
		const translated = translations.get(original.trim());
		if (translated === undefined || translated === original) continue;
		ref.entry[ref.field] = translated;
		if (!counted.has(ref.entry)) {
			counted.add(ref.entry);
			librePatched++;
		}
	}

	let added = 0;
	for (const item of newItems) {
		const clone = { ...item.found } as FurniDataEntry;
		if (item.name !== undefined) {
			if (item.translateName) {
				const tr = translations.get(item.name.trim());
				clone.name = tr && tr !== item.name ? tr : item.name;
			} else {
				clone.name = item.name;
			}
		}
		if (item.description !== undefined) {
			if (item.translateDesc) {
				const tr = translations.get(item.description.trim());
				clone.description =
					tr && tr !== item.description ? tr : item.description;
			} else {
				clone.description = item.description;
			}
		}
		if (!data[item.section]) data[item.section] = { furnitype: [] };
		data[item.section].furnitype.push(clone);
		added++;
	}

	const total =
		(data.roomitemtypes?.furnitype?.length ?? 0) +
		(data.wallitemtypes?.furnitype?.length ?? 0);

	return {
		json: JSON.stringify(data),
		patched: officialPatched + librePatched + added,
		added,
		total,
	};
}
