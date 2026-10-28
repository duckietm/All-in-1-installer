import path from "node:path";
import { getRuntimePath } from "@/lib/utils/runtime-path";
/**
 * Localized furnidata builder — generates FurnitureData_<lang>.json files
 * (nl/en/de/fr/es/tr/it/pt/fi/pl/ru/ar/ja) from the master FurnitureData.json
 * + official Habbo translations per hotel (where available) + LibreTranslate
 * fallback for customs.
 *
 * On each import we rebuild per-language files so new/updated furniture also
 * gets its translated names. Official translations are fetched from Habbo's
 * public gamedata (habbo.nl, habbo.com, habbo.de …) and cached in memory.
 */

import { existsSync, promises as fs } from "node:fs";
import type { HabboGamedataHotel } from "@/lib/habbo-gamedata-hotel";
import { habboFurnidataUrl } from "@/lib/habbo-gamedata-hotel";
import { logger } from "@/lib/logger";
import { getGamedataRoot } from "@/lib/services/furni-asset-dirs";
import {
	getFurnitureDataWritePaths,
	readFurniData,
	withFurniDataLock,
} from "@/lib/services/furni-data";
import { browserHeaders } from "@/lib/services/import/core/browser-headers";
import { siteSettings } from "@/lib/services/site-settings";
import { getTranslationWorker } from "@/lib/services/translation-pool";

export const FURNIDATA_LANGUAGES = [
	{ lang: "nl", hotel: "nl" as HabboGamedataHotel },
	{ lang: "en", hotel: "com" as HabboGamedataHotel },
	{ lang: "de", hotel: "de" as HabboGamedataHotel },
	{ lang: "fr", hotel: "fr" as HabboGamedataHotel },
	{ lang: "es", hotel: "es" as HabboGamedataHotel },
	{ lang: "tr", hotel: "com.tr" as HabboGamedataHotel },
	{ lang: "it", hotel: "it" as HabboGamedataHotel },
	{ lang: "pt", hotel: "com.br" as HabboGamedataHotel },
	{ lang: "fi", hotel: "fi" as HabboGamedataHotel },
	{ lang: "pl", hotel: "com" as HabboGamedataHotel },
	{ lang: "ru", hotel: "com" as HabboGamedataHotel },
	{ lang: "ar", hotel: "com" as HabboGamedataHotel },
	{ lang: "ja", hotel: "com" as HabboGamedataHotel },
] as const;

export type FurnidataLang = (typeof FURNIDATA_LANGUAGES)[number]["lang"];

/**
 * Master switch for FurnitureData localization. Rebuilding the per-language
 * files deep-clones the 100k+ entry master 13× and hits LibreTranslate, which
 * can spike RAM/CPU on every import. Admins can disable it in settings to skip
 * the work entirely (the master FurnitureData.json is still written by the
 * import itself). The manual "build languages" action passes `force` to run
 * regardless.
 */
async function translationEnabled(): Promise<boolean> {
	try {
		return await siteSettings.getBool("furnidata_translate_enabled", true);
	} catch {
		return true;
	}
}

export interface LanguageFileResult {
	lang: string;
	hotel: string;
	file: string;
	translatedRoom: number;
	translatedWall: number;
	total: number;
	ok: boolean;
	error?: string;
}

const LANG_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours — translations rarely change

interface LangCacheEntry {
	map: Map<string, Translation>;
	timestamp: number;
	loading?: Promise<Map<string, Translation>>;
}

const langCache = new Map<string, LangCacheEntry>();

// ── LibreTranslate (gratis, self-hosted) ─────────────────────────────
const LIBRE_DEFAULT_URL = "http://127.0.0.1:5000";
const LIBRE_CACHE_FILE = ".translations_libre_cache.json";
type LibreCache = Record<string, string>; // key: `${target}|${text}` → translated

let libreMemoryCache: Map<string, string> | null = null;
let libreCacheLoaded = false;

async function getLibreTranslateUrl(): Promise<string> {
	try {
		const v = (await siteSettings.get(
			"libretranslate_url",
			LIBRE_DEFAULT_URL,
		)) as string | null;
		const url = (v ?? LIBRE_DEFAULT_URL).trim() || LIBRE_DEFAULT_URL;
		return url.replace(/\/+$/, "");
	} catch {
		return LIBRE_DEFAULT_URL;
	}
}

async function loadLibreCache(): Promise<Map<string, string>> {
	if (libreMemoryCache && libreCacheLoaded) return libreMemoryCache;
	try {
		const gamedataRoot = await getGamedataRoot();
		const cachePath = gamedataRoot
			? getRuntimePath(gamedataRoot, "config", LIBRE_CACHE_FILE)
			: getRuntimePath(process.cwd(), LIBRE_CACHE_FILE);
		if (existsSync(cachePath)) {
			const raw = await fs.readFile(cachePath, "utf-8");
			const obj = JSON.parse(raw) as LibreCache;
			libreMemoryCache = new Map(Object.entries(obj));
		} else {
			libreMemoryCache = new Map();
		}
	} catch {
		libreMemoryCache = new Map();
	}
	libreCacheLoaded = true;
	return libreMemoryCache ?? new Map<string, string>();
}

async function saveLibreCache(): Promise<void> {
	if (!libreMemoryCache) return;
	try {
		const gamedataRoot = await getGamedataRoot();
		const cachePath = gamedataRoot
			? getRuntimePath(gamedataRoot, "config", LIBRE_CACHE_FILE)
			: getRuntimePath(process.cwd(), LIBRE_CACHE_FILE);
		const obj: LibreCache = Object.fromEntries(libreMemoryCache.entries());
		await fs.mkdir(path.dirname(cachePath), { recursive: true });
		await fs.writeFile(cachePath, JSON.stringify(obj), "utf-8");
	} catch (err) {
		logger.warn("[furni-i18n] Failed to save Libre cache", {
			error: (err as Error).message,
		});
	}
}

const LIBRE_BATCH_SIZE = 48;
// Kept low on purpose: the build already pegs a core with the synchronous
// deep-clone + stringify of the 100k+ entry master per language, so we avoid
// spreading onto multiple cores at once.
const LIBRE_CONCURRENCY = 2;
// Breathing room between languages so the event loop (and other CMS requests)
// is never monopolised by the build loop.
const BUILD_YIELD_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const yieldToEventLoop = () => new Promise((r) => setImmediate(r));

/**
 * Translate many texts in one go using LibreTranslate's array API
 * (q accepts string[] → translatedText: string[]). Deduplicates input,
 * serves everything already in the cache, then fetches the rest in
 * parallel batches. Returns a map of trimmed source text → translation.
 * Texts whose batch failed are simply absent from the result.
 */
async function translateManyWithLibre(
	texts: Iterable<string>,
	targetLang: string,
): Promise<Map<string, string>> {
	const result = new Map<string, string>();
	if (targetLang === "en") return result;

	const cache = await loadLibreCache();
	const pending = new Set<string>();
	for (const raw of texts) {
		const trimmed = raw.trim();
		if (!trimmed) continue;
		const key = `${targetLang}|${trimmed}`;
		const cached = cache.get(key);
		if (cached !== undefined) {
			result.set(trimmed, cached);
			continue;
		}
		pending.add(trimmed);
	}
	if (pending.size === 0) return result;

	const chunks: string[][] = [];
	let current: string[] = [];
	for (const text of pending) {
		current.push(text);
		if (current.length >= LIBRE_BATCH_SIZE) {
			chunks.push(current);
			current = [];
		}
	}
	if (current.length > 0) chunks.push(current);

	const url = await getLibreTranslateUrl();
	let failures = 0;
	let nextChunk = 0;
	const worker = async (): Promise<void> => {
		while (true) {
			const i = nextChunk++;
			if (i >= chunks.length) return;
			const chunk = chunks[i];
			try {
				const res = await fetch(`${url}/translate`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						q: chunk,
						source: "en",
						target: targetLang,
						format: "text",
					}),
					signal: AbortSignal.timeout(30_000),
				});
				if (!res.ok) {
					failures++;
					logger.warn(
						`[furni-i18n] LibreTranslate batch ${targetLang} failed: ${res.status}`,
					);
					continue;
				}
				const data = (await res.json()) as {
					translatedText?: string[] | string;
				};
				const out = Array.isArray(data.translatedText)
					? data.translatedText
					: typeof data.translatedText === "string"
						? [data.translatedText]
						: [];
				for (let j = 0; j < chunk.length; j++) {
					const translated =
						typeof out[j] === "string" && out[j] ? out[j] : chunk[j];
					result.set(chunk[j], translated);
					cache.set(`${targetLang}|${chunk[j]}`, translated);
				}
			} catch (err) {
				failures++;
				logger.warn(`[furni-i18n] LibreTranslate batch error (${targetLang})`, {
					error: (err as Error).message,
				});
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(LIBRE_CONCURRENCY, chunks.length) }, () =>
			worker(),
		),
	);

	if (failures > 0) {
		logger.warn(
			`[furni-i18n] LibreTranslate ${targetLang}: ${failures}/${chunks.length} batches failed`,
		);
	}
	// Persist whatever succeeded so rebuilds don't re-call the API.
	await saveLibreCache();
	return result;
}

import type {
	FurniDataMaster,
	PreparedLang,
	PreparedPatch,
	Translation,
} from "./furni-data-i18n-core";
/**
 * The pure clone / scan / stringify helpers live in furni-data-i18n-core so they
 * can run inside a worker thread (that module has no server-only / network deps).
 * They're imported here for the main-thread call paths and re-exported for
 * backward compatibility.
 */
import {
	finalizeLangFile,
	finalizePatch,
	prepareLangFile,
	preparePatch,
} from "./furni-data-i18n-core";

export type {
	FurniDataMaster,
	PatchEntry,
	PreparedLang,
	PreparedPatch,
	Translation,
} from "./furni-data-i18n-core";
export { lookupTranslation } from "./furni-data-i18n-core";

export async function fetchTranslationsForHotel(
	hotel: HabboGamedataHotel,
): Promise<Map<string, Translation>> {
	const cached = langCache.get(hotel);
	const now = Date.now();
	if (cached && !cached.loading && now - cached.timestamp < LANG_CACHE_TTL) {
		return cached.map;
	}
	if (cached?.loading) return cached.loading;

	const url = habboFurnidataUrl(hotel);

	const loading = (async () => {
		try {
			const res = await fetch(url, {
				signal: AbortSignal.timeout(20_000),
				headers: browserHeaders(),
			});
			if (!res.ok) {
				logger.warn(
					`[furni-i18n] Fetch failed for habbo.${hotel}: ${res.status}`,
				);
				return cached?.map ?? new Map<string, Translation>();
			}
			const data = await res.json();
			const map = new Map<string, Translation>();
			for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
				const arr = data?.[section]?.furnitype;
				if (!Array.isArray(arr)) continue;
				for (const e of arr) {
					const cn = typeof e?.classname === "string" ? e.classname : "";
					if (!cn) continue;
					// Keep first occurrence — mirrors the official file order.
					if (map.has(cn)) continue;
					map.set(cn, {
						name: typeof e?.name === "string" ? e.name : "",
						description:
							typeof e?.description === "string" ? e.description : "",
					});
				}
			}
			langCache.set(hotel, { map, timestamp: Date.now() });
			logger.debug(
				`[furni-i18n] Cached ${map.size} translations from habbo.${hotel}`,
			);
			return map;
		} catch (err) {
			logger.warn(`[furni-i18n] Fetch error for habbo.${hotel}`, {
				error: (err as Error).message,
			});
			return cached?.map ?? new Map<string, Translation>();
		}
	})();

	langCache.set(hotel, {
		map: cached?.map ?? new Map<string, Translation>(),
		timestamp: cached?.timestamp ?? 0,
		loading,
	});
	const result = await loading;
	// Clear loading flag but keep map+timestamp.
	const entry = langCache.get(hotel);
	if (entry) {
		entry.loading = undefined;
		entry.map = result;
		if (!entry.timestamp) entry.timestamp = Date.now();
	}
	return result;
}

async function getLocalizedWritePaths(lang: string): Promise<string[]> {
	const bases = await getFurnitureDataWritePaths();
	const out: string[] = [];
	for (const base of bases) {
		const dir = path.dirname(base);
		const langFile = `FurnitureData_${lang}.json`;
		out.push(getRuntimePath(dir, langFile));
	}
	// Deduplicate same normalized path.
	const seen = new Set<string>();
	return out.filter((p) => {
		const key = process.platform === "win32" ? p.toLowerCase() : p;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/**
 * Build all language files from the current master FurnitureData.json.
 * Each file is a full copy with name/description overridden where an official
 * translation exists for that classname. The CPU-heavy clone + 100k-entry scan
 * + stringify is offloaded to a worker thread (see translation-pool); only the
 * network/DB parts (fetching official translations, LibreTranslate, writing
 * files) stay on the main thread. Falls back to running the same pure helpers
 * on the main thread when no worker is available.
 */
export async function buildLocalizedFurniDataFiles(
	force = false,
	langs?: readonly string[],
): Promise<LanguageFileResult[]> {
	if (!force && !(await translationEnabled())) {
		logger.debug(
			"[furni-i18n] FurnitureData translation disabled by setting; skipping localized build.",
		);
		return [];
	}
	const langsToBuild =
		langs && langs.length > 0
			? FURNIDATA_LANGUAGES.filter((l) => langs.includes(l.lang))
			: FURNIDATA_LANGUAGES;
	return withFurniDataLock(async () => {
		const master = (await readFurniData()) as Record<
			string,
			{ furnitype: Array<Record<string, unknown>> }
		>;

		const worker = getTranslationWorker();
		if (worker) {
			// Reads the master + official maps once on the main thread (cached
			// per process) and ships them to the worker so the per-language
			// clone/scan/stringify runs off the main thread.
			await worker.ensureInit();
		}
		// Main-thread fallback store, used only when no worker is available.
		const localPrepared = new Map<string, PreparedLang>();

		const results: LanguageFileResult[] = [];

		for (const { lang, hotel } of langsToBuild) {
			try {
				// Yield before each language (except the first) so a long build
				// never pins the CPU continuously and the server stays responsive.
				if (results.length > 0) {
					await yieldToEventLoop();
					await sleep(BUILD_YIELD_MS);
				}

				let pendingTexts: string[];
				let preparedKey: string | null = null;
				if (worker) {
					pendingTexts = await worker.prepare(lang, hotel);
				} else {
					const map = await fetchTranslationsForHotel(hotel);
					const r = prepareLangFile(
						master as unknown as FurniDataMaster,
						lang,
						hotel,
						map,
					);
					pendingTexts = r.pendingTexts;
					preparedKey = lang;
					localPrepared.set(preparedKey, r);
				}

				// Pass 2 — batch-translate everything pending (network, async, so
				// this part never blocks the main thread regardless).
				const translations = await translateManyWithLibre(
					new Set(pendingTexts),
					lang,
				);

				let json: string;
				let translatedRoom = 0;
				let translatedWall = 0;
				let total = 0;
				if (worker) {
					const res = await worker.finalize(lang, translations);
					json = res.json;
					translatedRoom = res.translatedRoom;
					translatedWall = res.translatedWall;
					total = res.total;
				} else {
					const r = localPrepared.get(preparedKey ?? "");
					if (!r)
						throw new Error(
							`Missing localPrepared entry for key ${String(preparedKey)}`,
						);
					const res = finalizeLangFile(r.cloned, r.pendingRefs, translations);
					json = res.json;
					translatedRoom = res.translatedRoom;
					translatedWall = res.translatedWall;
					total = res.total;
					if (preparedKey != null) localPrepared.delete(preparedKey);
				}

				const targets = await getLocalizedWritePaths(lang);
				for (const target of targets) {
					await fs.mkdir(path.dirname(target), { recursive: true });
					const tmp = `${target}.tmp`;
					await fs.writeFile(tmp, json, "utf-8");
					await fs.rename(tmp, target);
				}

				// Persist the LibreTranslate cache once per language so the next
				// full build reuses translations instead of re-calling the API.
				if (lang !== "en") await saveLibreCache();

				results.push({
					lang,
					hotel,
					file: targets[0] ?? `FurnitureData_${lang}.json`,
					translatedRoom,
					translatedWall,
					total,
					ok: true,
				});
			} catch (err) {
				results.push({
					lang,
					hotel,
					file: `FurnitureData_${lang}.json`,
					translatedRoom: 0,
					translatedWall: 0,
					total: 0,
					ok: false,
					error: (err as Error).message,
				});
			}
		}

		return results;
	});
}

/**
 * Patch the language files for a small set of classnames (e.g. a single
 * import) without rebuilding every file from scratch. Used on single-import
 * paths where a full rebuild would be wasteful.
 */
export async function patchLocalizedFurniDataEntries(
	entries: Array<{ classname: string; name?: string; description?: string }>,
	force = false,
	langs?: readonly string[],
): Promise<LanguageFileResult[]> {
	if (entries.length === 0) return [];
	if (!force && !(await translationEnabled())) {
		logger.debug(
			"[furni-i18n] FurnitureData translation disabled by setting; skipping localized patch.",
		);
		return [];
	}

	const langsToBuild =
		langs && langs.length > 0
			? FURNIDATA_LANGUAGES.filter((l) => langs.includes(l.lang))
			: FURNIDATA_LANGUAGES;

	return withFurniDataLock(async () => {
		const worker = getTranslationWorker();
		// Fallback store for when there is no worker (test env / spawn failure).
		const localPrepared = new Map<string, PreparedPatch>();

		const results: LanguageFileResult[] = [];

		for (const { lang, hotel } of langsToBuild) {
			try {
				const targets = await getLocalizedWritePaths(lang);

				// Read the existing language file as raw text. The expensive
				// parse + scan + stringify all happen in the worker, so the main
				// thread only does async file I/O here.
				let fileContent: string | null = null;
				try {
					fileContent = await fs.readFile(targets[0], "utf-8");
				} catch {
					fileContent = null;
				}

				let pendingTexts: string[];
				let localKey: string | null = null;
				try {
					if (!worker) throw new Error("no translation worker");
					pendingTexts = await worker.patchPrepare(
						fileContent,
						lang,
						hotel,
						entries,
					);
				} catch {
					// Main-thread fallback: run the exact same pure helpers here.
					const master = (await readFurniData()) as unknown as FurniDataMaster;
					const map = await fetchTranslationsForHotel(hotel);
					const r = preparePatch(
						fileContent,
						master,
						lang,
						hotel,
						map,
						entries,
					);
					localPrepared.set(lang, r);
					pendingTexts = [...r.pendingTexts];
					localKey = lang;
				}

				// Batch-translate (network, async — never blocks the main thread).
				const translations = await translateManyWithLibre(
					new Set(pendingTexts),
					lang,
				);

				let json: string;
				let patched = 0;
				let added = 0;
				let total = 0;
				if (worker && localKey === null) {
					const res = await worker.patchFinalize(lang, translations);
					json = res.json;
					patched = res.patched;
					added = res.added;
					total = res.total;
				} else {
					const r = localPrepared.get(localKey ?? "");
					if (!r)
						throw new Error(
							`Missing localPrepared entry for key ${String(localKey)}`,
						);
					const res = finalizePatch(r, translations);
					json = res.json;
					patched = res.patched;
					added = res.added;
					total = res.total;
					if (localKey != null) localPrepared.delete(localKey);
				}

				for (const target of targets) {
					await fs.mkdir(path.dirname(target), { recursive: true });
					const tmp = `${target}.tmp`;
					await fs.writeFile(tmp, json, "utf-8");
					await fs.rename(tmp, target);
				}

				if (lang !== "en") await saveLibreCache();

				results.push({
					lang,
					hotel,
					file: targets[0] ?? `FurnitureData_${lang}.json`,
					translatedRoom: patched,
					translatedWall: added,
					total,
					ok: true,
				});
			} catch (err) {
				results.push({
					lang,
					hotel,
					file: `FurnitureData_${lang}.json`,
					translatedRoom: 0,
					translatedWall: 0,
					total: 0,
					ok: false,
					error: (err as Error).message,
				});
			}
		}

		return results;
	});
}

/** Visible for tests — apply translations to a furnidata clone in place. */
