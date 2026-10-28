import { resolveGordonBuildUrl } from "@/lib/services/import/core/gordon";
import { siteSettings } from "@/lib/services/site-settings";

export interface OfficialColor {
	id: number;
	index: number;
	club: number;
	selectable: boolean;
	hexCode: string;
}
export interface OfficialPalette {
	id: number;
	colors: OfficialColor[];
}
export interface OfficialPart {
	id: number;
	type: string;
	colorable: boolean;
	index: number;
	colorindex: number;
}
export interface OfficialSet {
	id: number;
	gender: string;
	club: number;
	colorable: boolean;
	selectable: boolean;
	preselectable: boolean;
	sellable: boolean;
	parts: OfficialPart[];
	hiddenLayers?: { partType: string }[];
}
export interface OfficialSetType {
	type: string;
	paletteId: number;
	mandM0: boolean;
	mandF0: boolean;
	mandM1: boolean;
	mandF1: boolean;
	sets: OfficialSet[];
}
export interface OfficialFigureData {
	palettes: OfficialPalette[];
	setTypes: OfficialSetType[];
}
export interface OfficialLibrary {
	id: string;
	revision: number;
	parts: { id: number; type: string }[];
}

const CACHE_TTL = 30 * 60 * 1000;
const DEFAULT_FIGUREDATA_URL = "https://www.habbo.com/gamedata/figuredata/1";
let fdCache: { data: OfficialFigureData; ts: number } | null = null;
let fmCache: { libs: OfficialLibrary[]; ts: number } | null = null;

export function __clearFigureOfficialCache(): void {
	fdCache = null;
	fmCache = null;
}

const attr = (tag: string, name: string): string | undefined =>
	new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const bool = (v: string | undefined): boolean => v === "1" || v === "true";
const num = (v: string | undefined): number => {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
};

export async function fetchOfficialFigureData(): Promise<OfficialFigureData> {
	const now = Date.now();
	if (fdCache && now - fdCache.ts < CACHE_TTL) return fdCache.data;
	const url = await siteSettings.get(
		"figuredata_source_url",
		DEFAULT_FIGUREDATA_URL,
	);
	const res = await fetch(url ?? DEFAULT_FIGUREDATA_URL, {
		signal: AbortSignal.timeout(30000),
	});
	if (!res.ok) throw new Error(`figuredata fetch failed: ${res.status}`);
	const xml = await res.text();

	const palettes: OfficialPalette[] = [];
	for (const pm of xml.matchAll(/<palette\b([^>]*)>([\s\S]*?)<\/palette>/g)) {
		const id = num(attr(pm[1], "id"));
		const colors: OfficialColor[] = [];
		for (const cm of pm[2].matchAll(/<color\b([^>]*)>([^<]*)<\/color>/g)) {
			colors.push({
				id: num(attr(cm[1], "id")),
				index: num(attr(cm[1], "index")),
				club: num(attr(cm[1], "club")),
				selectable: bool(attr(cm[1], "selectable")),
				hexCode: cm[2].trim(),
			});
		}
		palettes.push({ id, colors });
	}

	const setTypes: OfficialSetType[] = [];
	for (const sm of xml.matchAll(/<settype\b([^>]*)>([\s\S]*?)<\/settype>/g)) {
		const a = sm[1];
		const sets: OfficialSet[] = [];
		for (const setM of sm[2].matchAll(/<set\b([^>]*)>([\s\S]*?)<\/set>/g)) {
			const sa = setM[1];
			const parts: OfficialPart[] = [];
			for (const pm of setM[2].matchAll(/<part\b([^>]*)\/?>/g)) {
				parts.push({
					id: num(attr(pm[1], "id")),
					type: attr(pm[1], "type") ?? "",
					colorable: bool(attr(pm[1], "colorable")),
					index: num(attr(pm[1], "index")),
					colorindex: num(attr(pm[1], "colorindex")),
				});
			}
			const hiddenLayers: { partType: string }[] = [];
			for (const hm of setM[2].matchAll(/<layer\b([^>]*)\/?>/g)) {
				const pt = attr(hm[1], "parttype");
				if (pt) hiddenLayers.push({ partType: pt });
			}
			sets.push({
				id: num(attr(sa, "id")),
				gender: attr(sa, "gender") ?? "U",
				club: num(attr(sa, "club")),
				colorable: bool(attr(sa, "colorable")),
				selectable: bool(attr(sa, "selectable")),
				preselectable: bool(attr(sa, "preselectable")),
				sellable: bool(attr(sa, "sellable")),
				parts,
				hiddenLayers: hiddenLayers.length ? hiddenLayers : undefined,
			});
		}
		setTypes.push({
			type: attr(a, "type") ?? "",
			paletteId: num(attr(a, "paletteid")),
			mandM0: bool(attr(a, "mand_m_0")),
			mandF0: bool(attr(a, "mand_f_0")),
			mandM1: bool(attr(a, "mand_m_1")),
			mandF1: bool(attr(a, "mand_f_1")),
			sets,
		});
	}

	const data = { palettes, setTypes };
	fdCache = { data, ts: now };
	return data;
}

export async function fetchOfficialFigureMap(): Promise<OfficialLibrary[]> {
	const now = Date.now();
	if (fmCache && now - fmCache.ts < CACHE_TTL) return fmCache.libs;
	const override = (
		(await siteSettings.get("figure_swf_base_url", "")) ?? ""
	).trim();
	const base = override
		? `${override.replace(/\/+$/, "")}/`
		: await resolveGordonBuildUrl();
	const res = await fetch(`${base}figuremap.xml`, {
		signal: AbortSignal.timeout(30000),
	});
	if (!res.ok) throw new Error(`figuremap fetch failed: ${res.status}`);
	const xml = await res.text();
	const libs: OfficialLibrary[] = [];
	for (const lm of xml.matchAll(/<lib\b([^>]*)>([\s\S]*?)<\/lib>/g)) {
		const parts: { id: number; type: string }[] = [];
		for (const pm of lm[2].matchAll(/<part\b([^>]*)\/?>/g)) {
			parts.push({
				id: num(attr(pm[1], "id")),
				type: attr(pm[1], "type") ?? "",
			});
		}
		libs.push({
			id: attr(lm[1], "id") ?? "",
			revision: num(attr(lm[1], "revision")),
			parts,
		});
	}
	fmCache = { libs, ts: now };
	return libs;
}
