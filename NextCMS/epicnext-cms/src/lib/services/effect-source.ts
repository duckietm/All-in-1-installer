import { logger } from "@/lib/logger";
import { resolveGordonBuildUrl } from "@/lib/services/import/core/gordon";
import { siteSettings } from "@/lib/services/site-settings";
import type { EffectMapEntry } from "@/types/effects";

// Defaults to VALIDATE against a live fetch (spec Open Item #2). Override the
// SWF source with the `effect_swf_base_url` site setting if these drift.
const OFFICIAL_EFFECTMAP_URL = "https://www.habbo.com/gamedata/effectmap/1";
const CACHE_TTL = 30 * 60 * 1000;

let effectCache: { list: EffectMapEntry[]; ts: number } | null = null;

export function __clearEffectSourceCache(): void {
	effectCache = null;
}

function parseEffectMapXml(xml: string): EffectMapEntry[] {
	const out: EffectMapEntry[] = [];
	const re = /<effect\b([^>]*)\/?>/g;
	for (const m of xml.matchAll(re)) {
		const attrs = m[1];
		const id = /\bid="([^"]*)"/.exec(attrs)?.[1];
		const lib = /\blib="([^"]*)"/.exec(attrs)?.[1];
		const type = /\btype="([^"]*)"/.exec(attrs)?.[1] ?? "fx";
		const revision = Number(/\brevision="([^"]*)"/.exec(attrs)?.[1] ?? "0");
		if (id && lib)
			out.push({
				id,
				lib,
				type,
				revision: Number.isFinite(revision) ? revision : 0,
			});
	}
	return out;
}

export async function listOfficialEffects(): Promise<EffectMapEntry[]> {
	const now = Date.now();
	if (effectCache && now - effectCache.ts < CACHE_TTL) return effectCache.list;
	const res = await fetch(OFFICIAL_EFFECTMAP_URL, {
		signal: AbortSignal.timeout(20000),
	});
	if (!res.ok) {
		logger.warn(`[effect-source] effectmap fetch failed: ${res.status}`);
		return effectCache?.list ?? [];
	}
	const list = parseEffectMapXml(await res.text());
	effectCache = { list, ts: now };
	return list;
}

export async function resolveEffectSwfUrl(lib: string): Promise<string> {
	const override = (
		(await siteSettings.get("effect_swf_base_url", "")) ?? ""
	).trim();
	if (override) return `${override.replace(/\/+$/, "")}/${lib}.swf`;
	const gordon = await resolveGordonBuildUrl();
	return `${gordon}${lib}.swf`;
}
