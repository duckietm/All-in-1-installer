import os from "node:os";
import { Worker } from "node:worker_threads";
import type { WorkerRequest, WorkerResponse } from "./conversion-worker";
import {
	type ConversionResult,
	convertSwfToNitro,
	extractIconFromSwf,
} from "./index";
import type { NitroTextureFormat } from "./nitro-builder";

// Offloads the synchronous, CPU-heavy SWF→Nitro conversion (and icon
// extraction) to a small pool of worker threads so the main Node event loop
// stays free during imports — the conversion no longer blocks request handling
// or anything else running on the server.
//
// The pool degrades gracefully: if workers can't be created (bundling/runtime
// restrictions, or the test environment) every task falls back to running the
// pure conversion function synchronously on the main thread, so imports never
// break.

const POOL_SIZE = Math.max(1, Math.min(os.cpus().length - 1, 4));

interface Job {
	req: WorkerRequest;
	resolve: (r: WorkerResponse) => void;
	reject: (e: Error) => void;
}

const workers: Worker[] = [];
const idle: Worker[] = [];
const pending = new Map<number, { worker: Worker; job: Job }>();
const queue: Job[] = [];
let nextId = 1;
let broken = false;

function isTestEnv(): boolean {
	return process.env.NODE_ENV === "test" || process.env.VITEST !== undefined;
}

function spawn(): Worker | null {
	try {
		const w = new Worker(new URL("./conversion-worker.ts", import.meta.url));
		w.on("message", (res: WorkerResponse) => {
			const p = pending.get(res.id);
			if (!p) return;
			pending.delete(res.id);
			idle.push(w);
			p.job.resolve(res);
			pump();
		});
		w.on("error", (err: Error) => {
			broken = true;
			const p = [...pending.values()].find((x) => x.worker === w);
			if (p) {
				pending.delete(p.job.req.id);
				p.job.reject(err);
			}
		});
		return w;
	} catch {
		broken = true;
		return null;
	}
}

function ensurePool(): boolean {
	if (broken || isTestEnv()) return false;
	if (workers.length > 0) return true;
	for (let i = 0; i < POOL_SIZE; i++) {
		const w = spawn();
		if (!w) {
			broken = true;
			return false;
		}
		workers.push(w);
		idle.push(w);
	}
	return true;
}

function pump() {
	while (idle.length > 0 && queue.length > 0) {
		const w = idle.pop();
		const job = queue.shift();
		if (!w || !job) break;
		pending.set(job.req.id, { worker: w, job });
		w.postMessage(job.req);
	}
}

const CONVERSION_TIMEOUT_MS = 60_000;

// `Omit` does not distribute over a union, which would erase `textureFormat`
// from the convert variant.
type DistributiveOmit<T, K extends keyof never> = T extends unknown
	? Omit<T, K>
	: never;

function run(
	req: DistributiveOmit<WorkerRequest, "id">,
): Promise<WorkerResponse> {
	if (!ensurePool()) {
		// No pool available: run on the main thread. Icon extraction stays
		// synchronous; the conversion is async because it encodes a spritesheet.
		if (req.type === "icon") {
			try {
				return Promise.resolve({
					id: 0,
					ok: true,
					icon: extractIconFromSwf(req.buffer, req.classname),
				});
			} catch (e) {
				return Promise.resolve({
					id: 0,
					ok: false,
					error: (e as Error).message,
				});
			}
		}
		return convertSwfToNitro(req.buffer, req.classname, {
			textureFormat: req.textureFormat,
		}).then(
			(result) => ({ id: 0, ok: true, result }) as WorkerResponse,
			(e: Error) => ({ id: 0, ok: false, error: e.message }) as WorkerResponse,
		);
	}
	return new Promise<WorkerResponse>((resolve, reject) => {
		const job: Job = {
			req: { ...req, id: nextId++ } as WorkerRequest,
			resolve,
			reject,
		};
		queue.push(job);
		pump();

		// Timeout: if a job takes too long, remove it from the queue
		// and reject so the caller can fall back to main-thread conversion.
		const timer = setTimeout(() => {
			const idx = queue.findIndex((j) => j.req.id === job.req.id);
			if (idx !== -1) {
				queue.splice(idx, 1);
				pending.delete(job.req.id);
				reject(new Error("Conversion timed out"));
			} else {
				// Already dispatched to a worker — the worker is
				// responsible for timing out its own task.
				reject(new Error("Conversion timed out"));
			}
		}, CONVERSION_TIMEOUT_MS);

		// Clear the timer once the job resolves/rejects
		const origResolve = resolve;
		const origReject = reject;
		job.resolve = (r) => {
			clearTimeout(timer);
			origResolve(r);
		};
		job.reject = (e) => {
			clearTimeout(timer);
			origReject(e);
		};
	});
}

export async function convertSwfToNitroAsync(
	buffer: Buffer,
	classname: string,
	options?: { textureFormat?: NitroTextureFormat },
): Promise<ConversionResult> {
	const res = await run({
		type: "convert",
		buffer,
		classname,
		textureFormat: options?.textureFormat,
	}).catch(() => null);
	if (res?.ok && res.result) return res.result;
	// Worker failed for this item — fall back to the main thread.
	return convertSwfToNitro(buffer, classname, {
		textureFormat: options?.textureFormat,
	});
}

export async function extractIconFromSwfAsync(
	buffer: Buffer,
	classname: string,
): Promise<Buffer | null> {
	const res = await run({ type: "icon", buffer, classname }).catch(() => null);
	if (res?.ok) return res.icon ?? null;
	return extractIconFromSwf(buffer, classname);
}
