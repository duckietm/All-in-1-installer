// @vitest-environment node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimePath } from "@/lib/utils/runtime-path";

const dirs = vi.hoisted(() => ({
	gamedataRoot: "",
	furnitureData: "",
	figureData: "",
	figureMap: "",
	nitroDir: "",
	iconDir: "",
}));

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: {
		get: vi.fn(async (key: string, fallback: string) => {
			if (key === "gamedata_root") return dirs.gamedataRoot;
			if (key === "furni_data_url") return "/gamedata/FurnitureData.json";
			if (key === "figuredata_url") return "/gamedata/FigureData.json";
			if (key === "figuremap_url") return "/gamedata/FigureMap.json";
			if (key === "furni_nitro_dir") return dirs.nitroDir;
			if (key === "furni_icon_dir") return dirs.iconDir;
			return fallback;
		}),
	},
}));

import {
	__resetGamedataCleanupCache,
	cleanFigureData,
	cleanFigureMap,
	cleanFurnitureData,
	dedupeFurnitureData,
	GamedataCleanupLimitError,
	planGamedataCleanup,
	scanFurnitureDataDuplicates,
	scanFurnitureDataOrphans,
} from "./gamedata-dedupe";

const readJson = async (file: string) =>
	JSON.parse(await fs.readFile(file, "utf-8")) as Record<string, unknown>;
const writeJson = async (file: string, data: unknown) =>
	fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");

const room = (entries: Array<Record<string, unknown>>) => ({
	roomitemtypes: { furnitype: entries },
});
const figureData = (setTypes: unknown[], palettes: unknown[] = []) => ({
	palettes,
	setTypes,
});

async function addNitro(...classnames: string[]) {
	for (const classname of classnames)
		await fs.writeFile(path.join(dirs.nitroDir, `${classname}.nitro`), "x");
}
async function addIcon(...classnames: string[]) {
	for (const classname of classnames)
		await fs.writeFile(path.join(dirs.iconDir, `${classname}_icon.png`), "x");
}

beforeEach(async () => {
	// `gamedata_root` drives the real path resolution, so the fixtures sit
	// where the production resolvers put them: FurnitureData at the root,
	// FigureData/FigureMap in `config/`.
	const root = getRuntimePath(os.tmpdir(), "gamedata-dedupe-");
	await fs.rm(root, { recursive: true, force: true });
	dirs.gamedataRoot = root;
	dirs.furnitureData = path.join(root, "FurnitureData.json");
	dirs.figureData = path.join(root, "config", "FigureData.json");
	dirs.figureMap = path.join(root, "config", "FigureMap.json");
	dirs.nitroDir = path.join(root, "nitro");
	dirs.iconDir = path.join(root, "icons");
	await fs.mkdir(dirs.nitroDir, { recursive: true });
	await fs.mkdir(dirs.iconDir, { recursive: true });
	await fs.mkdir(path.dirname(dirs.figureData), { recursive: true });

	await writeJson(dirs.furnitureData, { roomitemtypes: { furnitype: [] } });
	await writeJson(dirs.figureData, { palettes: [], setTypes: [] });
	await writeJson(dirs.figureMap, { libraries: [] });
	__resetGamedataCleanupCache();
});

afterEach(async () => {
	await fs.rm(dirs.gamedataRoot, { recursive: true, force: true });
	__resetGamedataCleanupCache();
});

describe("scanFurnitureDataDuplicates", () => {
	it("finds nothing in a clean file", async () => {
		await writeJson(dirs.furnitureData, room([{ classname: "chair" }]));
		const { duplicates, crossSection } = await scanFurnitureDataDuplicates();
		expect(duplicates).toEqual([]);
		expect(crossSection).toEqual([]);
	});

	it("groups a repeated classname and keeps the newest import", async () => {
		// Two rows, one classname, so both name the same `.nitro` and the file
		// check cannot separate them: the higher `revision` decides.
		await writeJson(
			dirs.furnitureData,
			room([
				{ classname: "chair", revision: 1 },
				{ classname: "sofa", revision: 1 },
				{ classname: "chair", revision: 3 },
			]),
		);
		await addNitro("sofa", "chair");
		const { duplicates } = await scanFurnitureDataDuplicates();
		expect(duplicates).toHaveLength(1);
		expect(duplicates[0].classname).toBe("chair");
		expect(duplicates[0].keepIndex).toBe(2);
		expect(duplicates[0].removeIndexes).toEqual([0]);
		expect(duplicates[0].hasNitro).toBe(true);
		expect(duplicates[0].hasIcon).toBe(false);
		expect(duplicates[0].differsFromSurvivor).toBe(true);
	});

	it("keeps the first of two rows with the same revision", async () => {
		await writeJson(
			dirs.furnitureData,
			room([
				{ classname: "chair", revision: 2 },
				{ classname: "chair", revision: 2 },
			]),
		);
		const { duplicates } = await scanFurnitureDataDuplicates();
		expect(duplicates[0].keepIndex).toBe(0);
		// Byte-identical rows, so dropping one loses nothing.
		expect(duplicates[0].differsFromSurvivor).toBe(false);
	});

	it("matches classnames case-insensitively", async () => {
		await writeJson(
			dirs.furnitureData,
			room([{ classname: "chair" }, { classname: "CHAIR" }]),
		);
		const { duplicates } = await scanFurnitureDataDuplicates();
		expect(duplicates).toHaveLength(1);
	});

	it("reports, but does not group, a classname in both sections", async () => {
		await writeJson(dirs.furnitureData, {
			roomitemtypes: { furnitype: [{ classname: "chair" }] },
			wallitemtypes: { furnitype: [{ classname: "chair" }] },
		});
		const { duplicates, crossSection } = await scanFurnitureDataDuplicates();
		// Removing one would silently change the item's type.
		expect(duplicates).toEqual([]);
		expect(crossSection).toEqual([
			{ classname: "chair", sections: ["roomitemtypes", "wallitemtypes"] },
		]);
	});

	it("flags a removed duplicate that is not an exact copy", async () => {
		await writeJson(
			dirs.furnitureData,
			room([
				{ classname: "chair", revision: 1, name: "old" },
				{ classname: "chair", revision: 2, name: "new" },
			]),
		);
		await addNitro("chair");
		const { duplicates } = await scanFurnitureDataDuplicates();
		expect(duplicates[0].differsFromSurvivor).toBe(true);
	});
});

describe("dedupeFurnitureData", () => {
	it("removes the duplicate and keeps the freshest entry", async () => {
		await writeJson(
			dirs.furnitureData,
			room([
				{ classname: "chair", name: "old", revision: 1 },
				{ classname: "sofa" },
				{ classname: "chair", name: "new", revision: 4 },
			]),
		);
		await addNitro("chair", "sofa");
		const result = await dedupeFurnitureData();
		expect(result.removedDuplicates).toBe(1);
		expect(result.differingGroups).toBe(1);

		const after = (await readJson(dirs.furnitureData)) as {
			roomitemtypes: { furnitype: Array<{ classname: string; name: string }> };
		};
		expect(after.roomitemtypes.furnitype).toEqual([
			{ classname: "sofa" },
			{ classname: "chair", name: "new", revision: 4 },
		]);
	});

	it("keeps the first when neither duplicate has a bundle", async () => {
		await writeJson(
			dirs.furnitureData,
			room([{ classname: "chair", name: "first" }, { classname: "chair" }]),
		);
		await dedupeFurnitureData();
		const after = (await readJson(dirs.furnitureData)) as {
			roomitemtypes: { furnitype: Array<{ name: string }> };
		};
		expect(after.roomitemtypes.furnitype).toEqual([
			{ classname: "chair", name: "first" },
		]);
	});

	it("preserves the other section and other top-level keys", async () => {
		await writeJson(dirs.furnitureData, {
			roomitemtypes: {
				furnitype: [{ classname: "chair" }, { classname: "chair" }],
			},
			wallitemtypes: { furnitype: [{ classname: "poster" }] },
			palette: { custom: true },
		});
		await dedupeFurnitureData();
		const after = (await readJson(dirs.furnitureData)) as Record<string, never>;
		expect(after.wallitemtypes).toEqual({
			furnitype: [{ classname: "poster" }],
		});
		expect(after.palette).toEqual({ custom: true });
	});

	it("reports zero differing groups when nothing conflicts", async () => {
		await writeJson(dirs.furnitureData, room([{ classname: "chair" }]));
		await addNitro("chair");
		const result = await dedupeFurnitureData();
		expect(result).toMatchObject({ removedDuplicates: 0, differingGroups: 0 });
	});

	it("leaves entries without a classname alone", async () => {
		await writeJson(
			dirs.furnitureData,
			room([{ classname: "chair" }, { id: 9 }, { classname: "chair" }]),
		);
		await addNitro("chair");
		await dedupeFurnitureData();
		const after = (await readJson(dirs.furnitureData)) as {
			roomitemtypes: { furnitype: Array<{ id: number }> };
		};
		expect(after.roomitemtypes.furnitype).toEqual([
			{ classname: "chair" },
			{ id: 9 },
		]);
	});
});

describe("cleanFurnitureData", () => {
	it("removes entries whose bundle is missing", async () => {
		await writeJson(
			dirs.furnitureData,
			room([{ classname: "chair" }, { classname: "ghost" }]),
		);
		await addNitro("chair");
		expect(await cleanFurnitureData()).toMatchObject({ removedOrphans: 1 });
		const after = (await readJson(dirs.furnitureData)) as {
			roomitemtypes: { furnitype: Array<{ classname: string }> };
		};
		expect(after.roomitemtypes.furnitype).toEqual([{ classname: "chair" }]);
	});

	it("treats an icon without a bundle as an orphan", async () => {
		// The icon is tracked, but only the `.nitro` makes an item render.
		await writeJson(dirs.furnitureData, room([{ classname: "chair" }]));
		await addIcon("chair");
		expect(await cleanFurnitureData()).toMatchObject({ removedOrphans: 1 });
		const after = (await readJson(dirs.furnitureData)) as {
			roomitemtypes: { furnitype: unknown[] };
		};
		expect(after.roomitemtypes.furnitype).toEqual([]);
	});

	it("cleans both sections", async () => {
		await writeJson(dirs.furnitureData, {
			roomitemtypes: { furnitype: [{ classname: "chair" }] },
			wallitemtypes: { furnitype: [{ classname: "poster" }] },
		});
		await cleanFurnitureData();
		const after = (await readJson(dirs.furnitureData)) as Record<string, never>;
		expect(after.roomitemtypes).toEqual({ furnitype: [] });
		expect(after.wallitemtypes).toEqual({ furnitype: [] });
	});
});

describe("figure map and figure data", () => {
	it("removes a part whose set is missing from FigureData", async () => {
		await writeJson(
			dirs.figureData,
			figureData([{ type: "set", paletteId: 1, sets: [{ id: 10 }] }]),
		);
		await writeJson(dirs.figureMap, {
			libraries: [
				{
					id: "lib1",
					revision: 1,
					parts: [
						{ id: 10, type: "set" },
						{ id: 99, type: "set" },
					],
				},
			],
		});
		expect(await cleanFigureMap()).toMatchObject({
			removedParts: 1,
			removedLibraries: 0,
		});
		const after = (await readJson(dirs.figureMap)) as {
			libraries: Array<{ parts: unknown[] }>;
		};
		expect(after.libraries[0].parts).toEqual([{ id: 10, type: "set" }]);
	});

	it("removes an exactly repeated part but keeps the first", async () => {
		// Both `set:10` and `other:10` are valid, so the only fault is the
		// repeated `set:10`.
		await writeJson(
			dirs.figureData,
			figureData([
				{ type: "set", paletteId: 1, sets: [{ id: 10 }] },
				{ type: "other", paletteId: 1, sets: [{ id: 10 }] },
			]),
		);
		await writeJson(dirs.figureMap, {
			libraries: [
				{
					id: "lib1",
					revision: 1,
					parts: [
						{ id: 10, type: "set" },
						{ id: 10, type: "set" },
						{ id: 10, type: "other" },
					],
				},
			],
		});
		expect(await cleanFigureMap()).toMatchObject({
			removedParts: 1,
			removedLibraries: 0,
		});
		const after = (await readJson(dirs.figureMap)) as {
			libraries: Array<{ parts: Array<{ id: number; type: string }> }>;
		};
		expect(after.libraries[0].parts).toEqual([
			{ id: 10, type: "set" },
			{ id: 10, type: "other" },
		]);
	});

	it("drops a library left with no parts at all", async () => {
		// FigureData must hold a set, otherwise the "no information" guard
		// refuses to touch the map at all.
		await writeJson(
			dirs.figureData,
			figureData([{ type: "set", paletteId: 1, sets: [{ id: 10 }] }]),
		);
		await writeJson(dirs.figureMap, {
			libraries: [{ id: "lib1", revision: 1, parts: [{ id: 1, type: "set" }] }],
		});
		expect(await cleanFigureMap()).toMatchObject({
			removedParts: 1,
			removedLibraries: 1,
		});
		const after = (await readJson(dirs.figureMap)) as { libraries: unknown[] };
		expect(after.libraries).toEqual([]);
	});

	it("leaves a library that never had parts alone", async () => {
		await writeJson(dirs.figureData, figureData([]));
		await writeJson(dirs.figureMap, {
			libraries: [{ id: "nude", revision: 1 }],
		});
		expect(await cleanFigureMap()).toMatchObject({
			removedParts: 0,
			removedLibraries: 0,
		});
		const after = (await readJson(dirs.figureMap)) as {
			libraries: Array<{ id: string }>;
		};
		expect(after.libraries).toEqual([{ id: "nude", revision: 1 }]);
	});

	it("removes unreferenced sets and then unreferenced palettes", async () => {
		await writeJson(dirs.figureMap, {
			libraries: [
				{ id: "lib1", revision: 1, parts: [{ id: 10, type: "set" }] },
			],
		});
		await writeJson(
			dirs.figureData,
			figureData(
				[
					{ type: "set", paletteId: 1, sets: [{ id: 10 }, { id: 11 }] },
					{ type: "other", paletteId: 2, sets: [] },
				],
				[
					{ id: 1, colors: [] },
					{ id: 2, colors: [] },
					{ id: 3, colors: [] },
				],
			),
		);
		// Set 11 is unreferenced. Palette 2 is still used by the `other` set
		// type, so it stays even though that type has no sets. Palette 3 is
		// used by nobody.
		expect(await cleanFigureData()).toMatchObject({
			removedSets: 1,
			removedPalettes: 1,
		});
		const after = (await readJson(dirs.figureData)) as {
			palettes: Array<{ id: number }>;
			setTypes: Array<{ sets: Array<{ id: number }> }>;
		};
		expect(after.setTypes[0].sets).toEqual([{ id: 10 }]);
		expect(after.palettes.map((p) => p.id)).toEqual([1, 2]);
	});

	it("is a no-op when everything is referenced", async () => {
		await writeJson(dirs.figureMap, {
			libraries: [
				{ id: "lib1", revision: 1, parts: [{ id: 10, type: "set" }] },
			],
		});
		await writeJson(
			dirs.figureData,
			figureData(
				[{ type: "set", paletteId: 1, sets: [{ id: 10 }] }],
				[{ id: 1, colors: [] }],
			),
		);
		expect(await cleanFigureData()).toMatchObject({
			removedSets: 0,
			removedPalettes: 0,
		});
	});
});

describe("planGamedataCleanup", () => {
	it("gives the same answer from a preloaded copy of the file", async () => {
		// A 59 MB file parsed twice in one pass is the cost this avoids, so
		// both entry points have to accept the caller's copy.
		await writeJson(
			dirs.furnitureData,
			room([
				{ classname: "chair" },
				{ classname: "chair" },
				{ classname: "ghost" },
			]),
		);
		await addNitro("chair");
		const parsed = (await readJson(dirs.furnitureData)) as Record<
			string,
			never
		>;

		const { duplicates } = await scanFurnitureDataDuplicates(parsed);
		expect(duplicates).toHaveLength(1);
		const orphans = await scanFurnitureDataOrphans(parsed);
		expect(orphans.map((o) => o.classname)).toEqual(["ghost"]);
		// The loaded copy is only read from, never rewritten.
		expect(await fs.readFile(dirs.furnitureData, "utf-8")).toBe(
			JSON.stringify(parsed, null, 2),
		);
	});

	it("summarises every pass without writing anything", async () => {
		await writeJson(
			dirs.furnitureData,
			room([
				{ classname: "chair" },
				{ classname: "chair" },
				{ classname: "ghost" },
			]),
		);
		await addNitro("chair");
		await writeJson(
			dirs.figureData,
			figureData([{ type: "set", paletteId: 1, sets: [{ id: 10 }] }]),
		);
		await writeJson(dirs.figureMap, {
			libraries: [
				{ id: "lib1", revision: 1, parts: [{ id: 99, type: "set" }] },
			],
		});

		const before = await fs.readFile(dirs.furnitureData, "utf-8");
		const plan = await planGamedataCleanup();
		expect(plan.duplicates).toHaveLength(1);
		expect(plan.orphans.map((o) => o.classname)).toEqual(["ghost"]);
		expect(plan.figureMapIssues).toEqual([
			{ libraryId: "lib1", reason: "missing-set", partId: 99, partType: "set" },
		]);
		expect(plan.figureDataIssues).toContainEqual({
			reason: "unreferenced-set",
			id: 10,
			setType: "set",
		});
		// A plan must not touch the file.
		expect(await fs.readFile(dirs.furnitureData, "utf-8")).toBe(before);
	});
});

describe("safety guards", () => {
	/** Write a file so a test can prove it came back byte-for-byte. */
	const snapshot = async (file: string) => await fs.readFile(file, "utf-8");

	describe("removal limit", () => {
		it("refuses cleanFurnitureData above the limit and writes nothing", async () => {
			await writeJson(
				dirs.furnitureData,
				room([{ classname: "a" }, { classname: "b" }, { classname: "c" }]),
			);
			// No .nitro anywhere: all three look like orphans.
			const before = await snapshot(dirs.furnitureData);

			await expect(cleanFurnitureData({ maxRemovals: 2 })).rejects.toThrow(
				GamedataCleanupLimitError,
			);
			expect(await snapshot(dirs.furnitureData)).toBe(before);
		});

		it("names the pass, the count and the limit in the error", async () => {
			await writeJson(
				dirs.furnitureData,
				room([{ classname: "a" }, { classname: "b" }]),
			);
			const err = (await cleanFurnitureData({ maxRemovals: 1 }).catch(
				(e) => e,
			)) as GamedataCleanupLimitError;
			expect(err).toBeInstanceOf(GamedataCleanupLimitError);
			expect(err.pass).toBe("cleanFurnitureData");
			expect(err.wouldRemove).toBe(2);
			expect(err.maxRemovals).toBe(1);
		});

		it("proceeds once the limit is raised on purpose", async () => {
			await writeJson(
				dirs.furnitureData,
				room([{ classname: "a" }, { classname: "b" }]),
			);
			const result = await cleanFurnitureData({ maxRemovals: 2 });
			expect(result.removedOrphans).toBe(2);
		});

		it("refuses dedupe above the limit too", async () => {
			await writeJson(
				dirs.furnitureData,
				room([
					{ classname: "chair", revision: 1 },
					{ classname: "chair", revision: 2 },
					{ classname: "chair", revision: 3 },
				]),
			);
			const before = await snapshot(dirs.furnitureData);
			await expect(dedupeFurnitureData({ maxRemovals: 1 })).rejects.toThrow(
				GamedataCleanupLimitError,
			);
			expect(await snapshot(dirs.furnitureData)).toBe(before);
		});

		it("leaves a normal-sized cleanup alone", async () => {
			await writeJson(
				dirs.furnitureData,
				room([{ classname: "chair" }, { classname: "ghost" }]),
			);
			await addNitro("chair");
			const result = await cleanFurnitureData({ maxRemovals: 1 });
			expect(result.removedOrphans).toBe(1);
		});
	});

	describe("empty input", () => {
		it("does not strip FigureMap when FigureData holds no sets", async () => {
			await writeJson(dirs.figureData, figureData([]));
			await writeJson(dirs.figureMap, {
				libraries: [
					{ id: "lib1", revision: 1, parts: [{ id: 1, type: "set" }] },
				],
			});
			const before = await snapshot(dirs.figureMap);

			const result = await cleanFigureMap();
			expect(result.removedParts).toBe(0);
			// An empty FigureData is a wrong path or a half-finished import, not
			// proof that every part is broken.
			expect(result.skipped).toBeTruthy();
			expect(await snapshot(dirs.figureMap)).toBe(before);
		});

		it("does not delete every set when FigureMap references nothing", async () => {
			await writeJson(
				dirs.figureData,
				figureData([{ type: "set", paletteId: 1, sets: [{ id: 10 }] }]),
			);
			await writeJson(dirs.figureMap, { libraries: [] });
			const before = await snapshot(dirs.figureData);

			const result = await cleanFigureData();
			expect(result.removedSets).toBe(0);
			expect(result.skipped).toBeTruthy();
			expect(await snapshot(dirs.figureData)).toBe(before);
		});

		it("warns in the plan when a wrong asset path would orphan the catalog", async () => {
			await writeJson(
				dirs.furnitureData,
				room([{ classname: "a" }, { classname: "b" }, { classname: "c" }]),
			);
			const plan = await planGamedataCleanup();
			expect(plan.orphans).toHaveLength(3);
			expect(plan.warnings.join(" ")).toMatch(/furni_nitro_dir/);
		});

		it("warns in the plan when FigureMap is empty but FigureData has sets", async () => {
			await writeJson(
				dirs.figureData,
				figureData([{ type: "set", paletteId: 1, sets: [{ id: 10 }] }]),
			);
			await writeJson(dirs.figureMap, { libraries: [] });
			const plan = await planGamedataCleanup();
			expect(plan.warnings.join(" ")).toMatch(/figuremap_url/);
		});

		it("reports no warning on a healthy file", async () => {
			await writeJson(dirs.furnitureData, room([{ classname: "chair" }]));
			await addNitro("chair");
			await writeJson(
				dirs.figureData,
				figureData([{ type: "set", paletteId: 1, sets: [{ id: 10 }] }]),
			);
			await writeJson(dirs.figureMap, {
				libraries: [
					{ id: "lib1", revision: 1, parts: [{ id: 10, type: "set" }] },
				],
			});
			const plan = await planGamedataCleanup();
			expect(plan.warnings).toEqual([]);
		});
	});

	describe("backups", () => {
		it("copies FurnitureData aside before rewriting it", async () => {
			await writeJson(
				dirs.furnitureData,
				room([{ classname: "chair" }, { classname: "ghost" }]),
			);
			await addNitro("chair");
			const before = await snapshot(dirs.furnitureData);

			const result = await cleanFurnitureData();
			expect(result.backups).toHaveLength(1);
			const backup = result.backups[0];
			expect(backup).toMatch(/FurnitureData\.json\.bak-/);
			// The backup holds the file as it was before the pass ran.
			expect(await fs.readFile(backup, "utf-8")).toBe(before);
			expect(await snapshot(dirs.furnitureData)).not.toBe(before);
		});

		it("copies FigureData and FigureMap aside too", async () => {
			// The map keeps one valid part so the FigureData pass still has a
			// reference to work with, and drops one invalid part so it writes.
			await writeJson(dirs.figureMap, {
				libraries: [
					{
						id: "lib1",
						revision: 1,
						parts: [
							{ id: 99, type: "set" },
							{ id: 10, type: "set" },
						],
					},
				],
			});
			await writeJson(
				dirs.figureData,
				figureData([
					{ type: "set", paletteId: 1, sets: [{ id: 10 }, { id: 11 }] },
				]),
			);
			const mapBefore = await snapshot(dirs.figureMap);
			const dataBefore = await snapshot(dirs.figureData);

			const map = await cleanFigureMap();
			const data = await cleanFigureData();
			expect(map.backups).toHaveLength(1);
			expect(await fs.readFile(map.backups[0], "utf-8")).toBe(mapBefore);
			expect(await fs.readFile(data.backups[0], "utf-8")).toBe(dataBefore);
		});

		it("creates no backup when a pass has nothing to do", async () => {
			await writeJson(dirs.furnitureData, room([{ classname: "chair" }]));
			await addNitro("chair");
			const result = await cleanFurnitureData();
			expect(result.removedOrphans).toBe(0);
			expect(result.backups).toEqual([]);
		});

		it("restoring the backup brings the removed rows back", async () => {
			await writeJson(
				dirs.furnitureData,
				room([{ classname: "chair" }, { classname: "ghost" }]),
			);
			await addNitro("chair");
			const before = await snapshot(dirs.furnitureData);

			const result = await cleanFurnitureData();
			await fs.copyFile(result.backups[0], dirs.furnitureData);
			expect(await snapshot(dirs.furnitureData)).toBe(before);
		});
	});
});
