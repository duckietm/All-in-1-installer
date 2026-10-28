// @ts-nocheck
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/import/core/download", () => ({
	downloadFile: vi.fn(async () => ({ ok: true, size: 100 })),
}));
vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { get: vi.fn(async () => "") },
}));
vi.mock("@/lib/services/furni-asset-dirs", () => ({
	getGamedataRoot: vi.fn(async () => ""),
}));
vi.mock("@/lib/services/effect-source", () => ({
	resolveEffectSwfUrl: vi.fn(async (lib: string) => `https://x/${lib}.swf`),
	listOfficialEffects: vi.fn(async () => []),
}));
const mergeEffect = vi.fn(async () => {});
vi.mock("@/lib/services/effectmap", () => ({
	mergeEffect: (...a: unknown[]) =>
		mergeEffect(...(a as Parameters<typeof mergeEffect>)),
	removeEffect: vi.fn(async () => true),
	listLocalEffects: vi.fn(async () => []),
}));
const convertSwfToNitro = vi.fn(() => ({
	bundle: Buffer.from("nitro"),
	warnings: [],
}));
vi.mock("@/lib/services/swf-to-nitro", () => ({
	convertSwfToNitro: (...a: unknown[]) =>
		convertSwfToNitro(...(a as Parameters<typeof convertSwfToNitro>)),
}));
vi.mock("node:fs", async (orig) => {
	const real = (await orig()) as typeof import("node:fs");
	return {
		...real,
		existsSync: vi.fn(() => true),
		promises: {
			...real.promises,
			readFile: vi.fn(async () => Buffer.from("CWS")),
			writeFile: vi.fn(async () => {}),
			mkdir: vi.fn(async () => {}),
		},
	};
});

import { importSingleEffect } from "./effect-import";

describe("effect-import.importSingleEffect", () => {
	it("downloads, converts, writes .nitro, merges EffectMap", async () => {
		const r = await importSingleEffect({
			id: "5",
			lib: "Torch",
			type: "fx",
			revision: 59220,
		});
		expect(r.ok).toBe(true);
		expect(convertSwfToNitro).toHaveBeenCalled();
		expect(mergeEffect).toHaveBeenCalledWith({
			id: "5",
			lib: "Torch",
			type: "fx",
			revision: 59220,
		});
	});

	it("does NOT merge EffectMap when conversion throws (no orphan entry)", async () => {
		mergeEffect.mockClear();
		convertSwfToNitro.mockImplementationOnce(() => {
			throw new Error("bad swf");
		});
		const r = await importSingleEffect({
			id: "6",
			lib: "Jetpack",
			type: "fx",
			revision: 59200,
		});
		expect(r.ok).toBe(false);
		expect(mergeEffect).not.toHaveBeenCalled();
	});
});
