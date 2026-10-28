// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	convert: vi.fn(() => ({ bundle: Buffer.from("converted") })),
	icon: vi.fn(() => Buffer.from("icon")),
}));
vi.mock("./index", () => ({
	convertSwfToNitro: mocks.convert,
	extractIconFromSwf: mocks.icon,
}));
vi.mock("node:worker_threads", () => ({
	Worker: class extends EventEmitter {
		postMessage() {
			queueMicrotask(() =>
				this.emit("error", new Error("worker module missing")),
			);
		}
	},
}));
afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
	vi.clearAllMocks();
});
describe("conversion worker recovery", () => {
	it("falls back when worker startup rejects the conversion job", async () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("VITEST", undefined);
		const { convertSwfToNitroAsync } = await import("./conversion-pool");
		const data = Buffer.from("SWF");
		const result = await convertSwfToNitroAsync(data, "chair");
		expect(result.bundle.toString()).toBe("converted");
		expect(mocks.convert).toHaveBeenCalledWith(data, "chair", {
			textureFormat: undefined,
		});
	});
	it("passes the requested texture format through to the main-thread fallback", async () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("VITEST", undefined);
		const { convertSwfToNitroAsync } = await import("./conversion-pool");
		const data = Buffer.from("SWF");
		await convertSwfToNitroAsync(data, "chair", { textureFormat: "webp" });
		expect(mocks.convert).toHaveBeenCalledWith(data, "chair", {
			textureFormat: "webp",
		});
	});
	it("recovers icon extraction from a worker startup error", async () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("VITEST", undefined);
		const { extractIconFromSwfAsync } = await import("./conversion-pool");
		expect(
			(await extractIconFromSwfAsync(Buffer.from("SWF"), "chair"))?.toString(),
		).toBe("icon");
	});
});
