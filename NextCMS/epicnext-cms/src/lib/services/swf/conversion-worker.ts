import { parentPort } from "node:worker_threads";
import { convertSwfToNitro, extractIconFromSwf } from "./index";
import type { NitroTextureFormat } from "./nitro-builder";

export interface ConvertRequest {
	id: number;
	type: "convert";
	buffer: Buffer;
	classname: string;
	/** Omitted means the default (WebP Lossless). */
	textureFormat?: NitroTextureFormat;
}

export interface IconRequest {
	id: number;
	type: "icon";
	buffer: Buffer;
	classname: string;
}

export type WorkerRequest = ConvertRequest | IconRequest;

export type WorkerResponse =
	| {
			id: number;
			ok: true;
			result?: import("./index").ConversionResult;
			icon?: Buffer | null;
	  }
	| { id: number; ok: false; error: string };

if (parentPort) {
	parentPort.on("message", (msg: WorkerRequest) => {
		if (msg.type === "icon") {
			try {
				const icon = extractIconFromSwf(msg.buffer, msg.classname);
				parentPort?.postMessage({
					id: msg.id,
					ok: true,
					icon: icon ?? null,
				} satisfies WorkerResponse);
			} catch (err) {
				parentPort?.postMessage({
					id: msg.id,
					ok: false,
					error: (err as Error).message,
				} satisfies WorkerResponse);
			}
			return;
		}
		// The conversion encodes a spritesheet, which is async (sharp), so it
		// cannot share the synchronous try/catch above.
		void convertSwfToNitro(msg.buffer, msg.classname, {
			textureFormat: msg.textureFormat,
		})
			.then((result) => {
				parentPort?.postMessage({
					id: msg.id,
					ok: true,
					result,
				} satisfies WorkerResponse);
			})
			.catch((err: Error) => {
				parentPort?.postMessage({
					id: msg.id,
					ok: false,
					error: err.message,
				} satisfies WorkerResponse);
			});
	});
}
