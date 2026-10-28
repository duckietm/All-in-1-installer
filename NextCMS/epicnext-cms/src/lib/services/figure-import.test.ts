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
vi.mock("@/lib/services/figure-source", () => ({
	resolveFigureSwfUrl: vi.fn(async (lib: string) => `https://x/${lib}.swf`),
}));
vi.mock("@/lib/services/figuremap", () => ({
	listFigureLibraries: vi.fn(async () => [
		{ id: "Hair_F_Bob", revision: 1 },
		{ id: "shirt_M_x", revision: 2 },
		{ id: "Hat_U_y", revision: 3 },
	]),
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
		existsSync: vi.fn(() => false),
		promises: {
			...real.promises,
			readFile: vi.fn(async () => Buffer.from("CWS")),
			writeFile: vi.fn(async () => {}),
			mkdir: vi.fn(async () => {}),
			unlink: vi.fn(async () => {}),
		},
	};
});

import { getFigureList, importSingleFigure } from "./figure-import";

describe("figure-import", () => {
	it("paginates the library list with present flags", async () => {
		const { items, meta } = await getFigureList({
			search: "",
			page: 1,
			perPage: 2,
		});
		expect(items).toHaveLength(2);
		expect(meta).toMatchObject({ page: 1, perPage: 2, total: 3 });
		expect(items[0]).toMatchObject({ lib: "Hair_F_Bob", nitroExists: false });
	});

	it("filters by search", async () => {
		const { items, meta } = await getFigureList({
			search: "shirt",
			page: 1,
			perPage: 50,
		});
		expect(meta.total).toBe(1);
		expect(items[0].lib).toBe("shirt_M_x");
	});

	it("importSingleFigure downloads + converts + writes", async () => {
		const r = await importSingleFigure({ lib: "Hair_F_Bob" });
		expect(r.ok).toBe(true);
		expect(convertSwfToNitro).toHaveBeenCalled();
	});

	it("fails cleanly when conversion throws", async () => {
		convertSwfToNitro.mockImplementationOnce(() => {
			throw new Error("bad swf");
		});
		const r = await importSingleFigure({ lib: "shirt_M_x" });
		expect(r.ok).toBe(false);
		expect(r.error).toContain("conversion");
	});
});
