// @ts-nocheck
import { describe, expect, it, vi } from "vitest";

const mergeSet = vi.fn(async () => {});
const mergePalette = vi.fn(async () => {});
const mergeLibrary = vi.fn(async () => {});
const importSingleFigure = vi.fn(async () => ({
	ok: true,
	lib: "",
	warnings: [],
}));

vi.mock("@/lib/services/figure-official", () => ({
	fetchOfficialFigureData: vi.fn(async () => ({
		palettes: [{ id: 3, colors: [] }],
		setTypes: [
			{
				type: "ch",
				paletteId: 3,
				sets: [
					{
						id: 5000,
						gender: "M",
						club: 0,
						colorable: true,
						selectable: true,
						preselectable: false,
						sellable: true,
						parts: [
							{
								id: 4316,
								type: "ch",
								colorable: true,
								index: 0,
								colorindex: 1,
							},
						],
					},
				],
			},
		],
	})),
	fetchOfficialFigureMap: vi.fn(async () => [
		{ id: "shirt_M_x", revision: 1, parts: [{ id: 4316, type: "ch" }] },
	]),
}));
vi.mock("@/lib/services/figuredata", () => ({
	mergeSet: (...a: unknown[]) =>
		mergeSet(...(a as Parameters<typeof mergeSet>)),
	mergePalette: (...a: unknown[]) =>
		mergePalette(...(a as Parameters<typeof mergePalette>)),
	listLocalSetIds: vi.fn(async () => new Set<number>()),
}));
vi.mock("@/lib/services/figuremap", () => ({
	mergeLibrary: (...a: unknown[]) =>
		mergeLibrary(...(a as Parameters<typeof mergeLibrary>)),
	listFigureLibraries: vi.fn(async () => []),
}));
vi.mock("@/lib/services/figure-import", () => ({
	importSingleFigure: (...a: unknown[]) =>
		importSingleFigure(...(a as Parameters<typeof importSingleFigure>)),
	ensureFigureDirs: vi.fn(async () => {}),
}));

import { importClothingSet } from "./clothing-set-import";

describe("importClothingSet", () => {
	it("imports the libraries for the set parts, then merges set + palette", async () => {
		const r = await importClothingSet({ setType: "ch", setId: 5000 });
		expect(r.ok).toBe(true);
		expect(importSingleFigure).toHaveBeenCalledWith(
			expect.objectContaining({ lib: "shirt_M_x" }),
		);
		expect(mergeLibrary).toHaveBeenCalledWith(
			expect.objectContaining({ id: "shirt_M_x" }),
		);
		expect(mergeSet).toHaveBeenCalledWith(
			"ch",
			3,
			expect.objectContaining({ id: 5000 }),
		);
		expect(mergePalette).toHaveBeenCalledWith(
			expect.objectContaining({ id: 3 }),
		);
	});

	it("fails when the set is not in official figuredata", async () => {
		const r = await importClothingSet({ setType: "ch", setId: 999999 });
		expect(r.ok).toBe(false);
	});

	it("does not write set data when a required library import fails", async () => {
		mergeSet.mockClear();
		mergePalette.mockClear();
		importSingleFigure.mockResolvedValueOnce({
			ok: false,
			lib: "shirt_M_x",
			warnings: [],
		} as Awaited<ReturnType<typeof importSingleFigure>>);
		const r = await importClothingSet({ setType: "ch", setId: 5000 });
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/required figure libraries failed/i);
		expect(mergeSet).not.toHaveBeenCalled();
		expect(mergePalette).not.toHaveBeenCalled();
	});
});
