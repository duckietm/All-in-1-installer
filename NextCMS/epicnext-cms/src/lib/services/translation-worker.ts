import { parentPort } from "node:worker_threads";
import type { HabboGamedataHotel } from "@/lib/habbo-gamedata-hotel";
import {
	type FurniDataMaster,
	finalizeLangFile,
	finalizePatch,
	type PatchEntry,
	type PreparedLang,
	type PreparedPatch,
	prepareLangFile,
	preparePatch,
	type Translation,
} from "./furni-data-i18n-core";

interface InitMsg {
	id: number;
	type: "init";
	masterJson: string;
	hotelMaps: Record<string, Map<string, Translation>>;
}
interface PrepareMsg {
	id: number;
	type: "prepare";
	lang: string;
	hotel: string;
}
interface FinalizeMsg {
	id: number;
	type: "finalize";
	lang: string;
	translations: Map<string, string>;
}
interface PatchPrepareMsg {
	id: number;
	type: "patchPrepare";
	lang: string;
	hotel: string;
	fileContent: string | null;
	entries: PatchEntry[];
}
interface PatchFinalizeMsg {
	id: number;
	type: "patchFinalize";
	lang: string;
	translations: Map<string, string>;
}
type Msg =
	| InitMsg
	| PrepareMsg
	| FinalizeMsg
	| PatchPrepareMsg
	| PatchFinalizeMsg;

let master: FurniDataMaster | null = null;
let hotelMaps: Record<string, Map<string, Translation>> = {};
const prepared = new Map<string, PreparedLang>();
const preparedPatches = new Map<string, PreparedPatch>();

if (parentPort) {
	const port = parentPort;
	port.on("message", (msg: Msg) => {
		try {
			if (msg.type === "init") {
				master = JSON.parse(msg.masterJson);
				hotelMaps = msg.hotelMaps ?? {};
				port.postMessage({ id: msg.id, ok: true });
				return;
			}
			if (msg.type === "prepare") {
				if (!master) throw new Error("translation worker not initialized");
				const officialMap =
					hotelMaps[msg.hotel] ?? new Map<string, Translation>();
				const r = prepareLangFile(
					master,
					msg.lang,
					msg.hotel as HabboGamedataHotel,
					officialMap,
				);
				prepared.set(msg.lang, r);
				port.postMessage({
					id: msg.id,
					ok: true,
					pendingTexts: r.pendingTexts,
				});
				return;
			}
			if (msg.type === "patchPrepare") {
				if (!master) throw new Error("translation worker not initialized");
				const officialMap =
					hotelMaps[msg.hotel] ?? new Map<string, Translation>();
				const r = preparePatch(
					msg.fileContent,
					master,
					msg.lang,
					msg.hotel as HabboGamedataHotel,
					officialMap,
					msg.entries,
				);
				preparedPatches.set(msg.lang, r);
				port.postMessage({
					id: msg.id,
					ok: true,
					pendingTexts: [...r.pendingTexts],
				});
				return;
			}
			if (msg.type === "patchFinalize") {
				const r = preparedPatches.get(msg.lang);
				if (!r) throw new Error(`no prepared patch for ${msg.lang}`);
				const res = finalizePatch(r, msg.translations);
				preparedPatches.delete(msg.lang);
				port.postMessage({ id: msg.id, ok: true, ...res });
				return;
			}
			// finalize
			const r = prepared.get(msg.lang);
			if (!r) throw new Error(`no prepared data for ${msg.lang}`);
			const res = finalizeLangFile(r.cloned, r.pendingRefs, msg.translations);
			prepared.delete(msg.lang);
			port.postMessage({ id: msg.id, ok: true, ...res });
		} catch (err) {
			port.postMessage({
				id: msg.id,
				ok: false,
				error: (err as Error).message,
			});
		}
	});
}
