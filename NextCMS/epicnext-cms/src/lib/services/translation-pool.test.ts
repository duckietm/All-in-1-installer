// @ts-nocheck
import { afterEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({
	mode: "ok" as "ok" | "fail",
	posted: [] as Array<Record<string, unknown>>,
}));

vi.mock("node:worker_threads", () => {
	type Handler = (...args: unknown[]) => void;
	class FakeWorker {
		private handlers: Record<string, Handler[]> = {};
		on(event: string, handler: Handler) {
			if (!this.handlers[event]) this.handlers[event] = [];
			this.handlers[event].push(handler);
			return this;
		}
		emit(event: string, ...args: unknown[]) {
			for (const handler of this.handlers[event] ?? []) handler(...args);
		}
		postMessage(req: Record<string, unknown>) {
			control.posted.push(req);
			queueMicrotask(() => {
				if (control.mode === "fail") {
					this.emit("message", {
						id: req.id,
						ok: false,
						error: "worker boom",
					});
					return;
				}
				switch (req.type) {
					case "init":
						this.emit("message", { id: req.id, ok: true });
						break;
					case "prepare":
						this.emit("message", {
							id: req.id,
							ok: true,
							pendingTexts: ["a", "b"],
						});
						break;
					case "finalize":
						this.emit("message", {
							id: req.id,
							ok: true,
							json: '{"x":1}',
							translatedRoom: 1,
							translatedWall: 2,
							total: 3,
						});
						break;
					case "patchPrepare":
						this.emit("message", {
							id: req.id,
							ok: true,
							pendingTexts: ["c"],
						});
						break;
					case "patchFinalize":
						this.emit("message", {
							id: req.id,
							ok: true,
							json: '{"y":2}',
							patched: 4,
							added: 5,
							total: 6,
						});
						break;
					default:
						this.emit("message", {
							id: req.id,
							ok: false,
							error: "unknown",
						});
				}
			});
		}
		close() {}
	}
	return { Worker: FakeWorker };
});

vi.mock("@/lib/services/furni-data", () => ({
	readFurniData: async () => ({ roomitemtypes: {} }),
}));

vi.mock("@/lib/services/furni-data-i18n", () => ({
	FURNIDATA_LANGUAGES: [
		{ hotel: "com", lang: "en" },
		{ hotel: "com", lang: "nl" },
		{ hotel: "es", lang: "es" },
	],
	fetchTranslationsForHotel: async () => new Map(),
}));

import { getTranslationWorker } from "./translation-pool";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("getTranslationWorker", () => {
	it("returns null in the test environment", () => {
		vi.stubEnv("NODE_ENV", "test");
		vi.stubEnv("VITEST", "true");
		expect(getTranslationWorker()).toBeNull();
	});

	it("exposes the full worker interface", async () => {
		const prevNodeEnv = process.env.NODE_ENV;
		const prevVitest = process.env.VITEST;
		process.env.NODE_ENV = "production";
		delete process.env.VITEST;
		try {
			control.mode = "ok";
			const worker = getTranslationWorker();
			expect(worker).not.toBeNull();
			if (!worker) return;

			await worker.ensureInit();
			expect(await worker.prepare("nl", "com")).toEqual(["a", "b"]);
			expect(await worker.finalize("nl", new Map([["a", "b"]]))).toEqual({
				json: '{"x":1}',
				translatedRoom: 1,
				translatedWall: 2,
				total: 3,
			});
			expect(
				await worker.patchPrepare("{}", "nl", "com", [
					{ key: "a", value: "b" },
				] as never),
			).toEqual(["c"]);
			expect(await worker.patchFinalize("nl", new Map())).toEqual({
				json: '{"y":2}',
				patched: 4,
				added: 5,
				total: 6,
			});
		} finally {
			process.env.NODE_ENV = prevNodeEnv;
			if (prevVitest === undefined) delete process.env.VITEST;
			else process.env.VITEST = prevVitest;
		}
	});

	it("surfaces worker errors as rejections", async () => {
		const prevNodeEnv = process.env.NODE_ENV;
		const prevVitest = process.env.VITEST;
		process.env.NODE_ENV = "production";
		delete process.env.VITEST;
		try {
			control.mode = "fail";
			const worker = getTranslationWorker();
			if (!worker) return;
			await expect(worker.prepare("nl", "com")).rejects.toThrow("worker boom");
		} finally {
			process.env.NODE_ENV = prevNodeEnv;
			if (prevVitest === undefined) delete process.env.VITEST;
			else process.env.VITEST = prevVitest;
		}
	});
});
