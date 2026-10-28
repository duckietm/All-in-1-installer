// @ts-nocheck
import { promises as fs } from "node:fs";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimePath } from "@/lib/utils/runtime-path";
import type { FigureLibrary } from "./figuremap";
import {
	__setFigureMapPathForTests,
	listFigureLibraries,
	mergeLibrary,
} from "./figuremap";

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { get: vi.fn(async () => "") },
}));

let dir: string;
let file: string;

const LIB: FigureLibrary = {
	id: "h_human",
	revision: 1,
	parts: [{ id: 1, type: "hd" }],
};

beforeEach(async () => {
	dir = await fs.mkdtemp(getRuntimePath(os.tmpdir(), "figuremap-"));
	file = getRuntimePath(dir, "FigureMap.json");
	await fs.writeFile(file, JSON.stringify({ libraries: [LIB] }));
	__setFigureMapPathForTests(file);
});

afterEach(async () => {
	__setFigureMapPathForTests(null);
	await fs.rm(dir, { recursive: true, force: true });
});

describe("lib/services/figuremap", () => {
	it("lists figure libraries from the map", async () => {
		const libraries = await listFigureLibraries();
		expect(libraries).toEqual([LIB]);
	});

	it("returns an empty list when the file has no libraries array", async () => {
		await fs.writeFile(file, JSON.stringify({}));
		expect(await listFigureLibraries()).toEqual([]);
	});

	it("adds a new library via mergeLibrary", async () => {
		const added: FigureLibrary = { id: "hh_human", revision: 2 };
		await mergeLibrary(added);
		const libraries = await listFigureLibraries();
		expect(libraries).toHaveLength(2);
		expect(libraries).toContainEqual(added);
	});

	it("updates an existing library in place via mergeLibrary", async () => {
		await mergeLibrary({ ...LIB, revision: 9 });
		const libraries = await listFigureLibraries();
		expect(libraries).toHaveLength(1);
		expect(libraries[0].revision).toBe(9);
	});
});
