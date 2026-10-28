import { Worker } from "node:worker_threads";
import type { PatchEntry, Translation } from "./furni-data-i18n-core";

/**
 * Runs the CPU-heavy FurnitureData localization (deep clone + 100k-entry scans +
 * JSON.stringify) in a single worker thread so the main Node event loop stays
 * free during a "translate everything" build and during per-import patches.
 * Network/DB work (fetching official Habbo translations, calling LibreTranslate,
 * writing files) stays on the main thread; only the synchronous CPU is offloaded.
 *
 * Degrades gracefully: in the test environment (or if the worker can't be
 * created) getTranslationWorker() returns null and callers run the same pure
 * helpers on the main thread instead.
 */
interface InitReq {
	id: number;
	type: "init";
	masterJson: string;
	hotelMaps: Record<string, Map<string, Translation>>;
}
interface PrepareReq {
	id: number;
	type: "prepare";
	lang: string;
	hotel: string;
}
interface FinalizeReq {
	id: number;
	type: "finalize";
	lang: string;
	translations: Map<string, string>;
}
interface PatchPrepareReq {
	id: number;
	type: "patchPrepare";
	lang: string;
	hotel: string;
	fileContent: string | null;
	entries: PatchEntry[];
}
interface PatchFinalizeReq {
	id: number;
	type: "patchFinalize";
	lang: string;
	translations: Map<string, string>;
}
type Req =
	| InitReq
	| PrepareReq
	| FinalizeReq
	| PatchPrepareReq
	| PatchFinalizeReq;
type ReqWithoutId =
	| Omit<InitReq, "id">
	| Omit<PrepareReq, "id">
	| Omit<FinalizeReq, "id">
	| Omit<PatchPrepareReq, "id">
	| Omit<PatchFinalizeReq, "id">;

type Res =
	| {
			id: number;
			ok: true;
			pendingTexts?: string[];
			json?: string;
			translatedRoom?: number;
			translatedWall?: number;
			patched?: number;
			added?: number;
			total?: number;
	  }
	| { id: number; ok: false; error: string };

let worker: Worker | null = null;
let broken = false;
let initialized = false;
let nextId = 1;
const pending = new Map<
	number,
	{ resolve: (r: Res) => void; reject: (e: Error) => void }
>();

function isTestEnv(): boolean {
	return process.env.NODE_ENV === "test" || process.env.VITEST !== undefined;
}

function spawn(): Worker | null {
	try {
		const w = new Worker(new URL("./translation-worker.ts", import.meta.url));
		w.on("message", (res: Res) => {
			const p = pending.get(res.id);
			if (!p) return;
			pending.delete(res.id);
			if (res.ok) p.resolve(res);
			else p.reject(new Error(res.error));
		});
		w.on("error", (err: Error) => {
			broken = true;
			for (const [, p] of pending) p.reject(err);
			pending.clear();
		});
		return w;
	} catch {
		broken = true;
		return null;
	}
}

function call(req: ReqWithoutId): Promise<Res> {
	if (!worker) return Promise.reject(new Error("no translation worker"));
	const w = worker;
	return new Promise<Res>((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		w.postMessage({ ...req, id } as Req);
	});
}

/**
 * Read the master FurnitureData + each hotel's official translation map once and
 * initialize the worker. Idempotent — safe to call before every operation.
 * Reads happen on the main thread but only once per process, so the per-import
 * CPU cost of parsing the 100k-entry master is amortized away.
 */
async function ensureInit(): Promise<void> {
	if (!worker || initialized) return;
	const { readFurniData } = await import("@/lib/services/furni-data");
	const { fetchTranslationsForHotel, FURNIDATA_LANGUAGES } = await import(
		"@/lib/services/furni-data-i18n"
	);
	const master = (await readFurniData()) as Record<string, unknown>;
	const hotels = [...new Set(FURNIDATA_LANGUAGES.map((l) => l.hotel))];
	const hotelMaps: Record<string, Map<string, Translation>> = {};
	for (const h of hotels) hotelMaps[h] = await fetchTranslationsForHotel(h);
	const res = await call({
		type: "init",
		masterJson: JSON.stringify(master),
		hotelMaps,
	});
	if (!res.ok) throw new Error(res.error);
	initialized = true;
}

export interface TranslationWorker {
	ensureInit(): Promise<void>;
	prepare(lang: string, hotel: string): Promise<string[]>;
	finalize(
		lang: string,
		translations: Map<string, string>,
	): Promise<{
		json: string;
		translatedRoom: number;
		translatedWall: number;
		total: number;
	}>;
	patchPrepare(
		fileContent: string | null,
		lang: string,
		hotel: string,
		entries: PatchEntry[],
	): Promise<string[]>;
	patchFinalize(
		lang: string,
		translations: Map<string, string>,
	): Promise<{ json: string; patched: number; added: number; total: number }>;
}

export function getTranslationWorker(): TranslationWorker | null {
	if (isTestEnv() || broken) return null;
	if (!worker) worker = spawn();
	if (!worker) return null;
	return {
		async ensureInit() {
			await ensureInit();
		},
		async prepare(lang, hotel) {
			await ensureInit();
			const res = await call({ type: "prepare", lang, hotel });
			if (!res.ok || !res.pendingTexts)
				throw new Error(res.ok ? "missing pendingTexts" : res.error);
			return res.pendingTexts;
		},
		async finalize(lang, translations) {
			const res = await call({ type: "finalize", lang, translations });
			if (!res.ok || res.json === undefined)
				throw new Error(res.ok ? "missing json" : res.error);
			return {
				json: res.json,
				translatedRoom: res.translatedRoom ?? 0,
				translatedWall: res.translatedWall ?? 0,
				total: res.total ?? 0,
			};
		},
		async patchPrepare(fileContent, lang, hotel, entries) {
			await ensureInit();
			const res = await call({
				type: "patchPrepare",
				lang,
				hotel,
				fileContent,
				entries,
			});
			if (!res.ok || !res.pendingTexts)
				throw new Error(res.ok ? "missing pendingTexts" : res.error);
			return res.pendingTexts;
		},
		async patchFinalize(lang, translations) {
			const res = await call({ type: "patchFinalize", lang, translations });
			if (!res.ok || res.json === undefined)
				throw new Error(res.ok ? "missing json" : res.error);
			return {
				json: res.json,
				patched: res.patched ?? 0,
				added: res.added ?? 0,
				total: res.total ?? 0,
			};
		},
	};
}
