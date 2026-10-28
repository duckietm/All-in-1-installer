import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	bundleExistsInDir,
	bundleExistsInDirs,
	bundleFileNames,
	bundleWritePathInDir,
	existingBundlePaths,
	resolveBundleFileNameInDir,
	resolveBundleInDir,
	resolveBundleInDirs,
	stripBundleExt,
} from "./bundle-file";

let dir: string;
let mirror: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "hab-bundle-"));
	mirror = await fs.mkdtemp(path.join(os.tmpdir(), "hab-bundle-mirror-"));
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
	await fs.rm(mirror, { recursive: true, force: true });
});

describe("bundleFileNames", () => {
	it("prefers `.hab` and keeps `.nitro` as the legacy fallback", () => {
		expect(bundleFileNames("sofa_blue")).toEqual([
			"sofa_blue.hab",
			"sofa_blue.nitro",
		]);
	});
});

describe("stripBundleExt", () => {
	it("strips either extension", () => {
		expect(stripBundleExt("sofa_blue.hab")).toBe("sofa_blue");
		expect(stripBundleExt("sofa_blue.nitro")).toBe("sofa_blue");
		expect(stripBundleExt("SOFA_BLUE.HAB")).toBe("SOFA_BLUE");
	});
	it("rejects anything else", () => {
		expect(stripBundleExt("sofa_blue.png")).toBeNull();
		expect(stripBundleExt("sofa_blue")).toBeNull();
	});
});

describe("resolution", () => {
	it("finds a `.hab` bundle", async () => {
		await fs.writeFile(path.join(dir, "sofa_blue.hab"), "x");
		expect(bundleExistsInDir(dir, "sofa_blue")).toBe(true);
		expect(resolveBundleInDir(dir, "sofa_blue")).toBe(
			path.join(dir, "sofa_blue.hab"),
		);
		expect(resolveBundleFileNameInDir(dir, "sofa_blue")).toBe("sofa_blue.hab");
	});

	// The whole point of the fallback: an import must not report an item as
	// missing just because its bundle predates the `.hab` convention.
	it("still finds a legacy `.nitro` bundle", async () => {
		await fs.writeFile(path.join(dir, "sofa_blue.nitro"), "x");
		expect(bundleExistsInDir(dir, "sofa_blue")).toBe(true);
		expect(resolveBundleInDir(dir, "sofa_blue")).toBe(
			path.join(dir, "sofa_blue.nitro"),
		);
		expect(resolveBundleFileNameInDir(dir, "sofa_blue")).toBe(
			"sofa_blue.nitro",
		);
	});

	it("reports a missing bundle", async () => {
		expect(bundleExistsInDir(dir, "sofa_blue")).toBe(false);
		expect(resolveBundleInDir(dir, "sofa_blue")).toBeNull();
		expect(resolveBundleFileNameInDir(dir, "sofa_blue")).toBeNull();
	});

	it("searches mirrors when the primary has nothing", async () => {
		await fs.writeFile(path.join(mirror, "sofa_blue.nitro"), "x");
		expect(bundleExistsInDirs([dir, mirror], "sofa_blue")).toBe(true);
		expect(resolveBundleInDirs([dir, mirror], "sofa_blue")).toBe(
			path.join(mirror, "sofa_blue.nitro"),
		);
	});

	it("prefers `.hab` over a same-stem legacy file", async () => {
		await fs.writeFile(path.join(dir, "sofa_blue.nitro"), "old");
		await fs.writeFile(path.join(dir, "sofa_blue.hab"), "new");
		expect(resolveBundleFileNameInDir(dir, "sofa_blue")).toBe("sofa_blue.hab");
	});
});

describe("writing", () => {
	it("always writes `.hab`", () => {
		expect(bundleWritePathInDir("/assets", "sofa_blue")).toBe(
			path.join("/assets", "sofa_blue.hab"),
		);
	});

	it("lists every existing variant so a delete can never leave one behind", async () => {
		await fs.writeFile(path.join(dir, "sofa_blue.hab"), "x");
		await fs.writeFile(path.join(mirror, "sofa_blue.nitro"), "x");
		expect(existingBundlePaths([dir, mirror], "sofa_blue")).toEqual([
			path.join(dir, "sofa_blue.hab"),
			path.join(mirror, "sofa_blue.nitro"),
		]);
	});
});
