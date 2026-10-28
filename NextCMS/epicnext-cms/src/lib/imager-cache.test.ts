// @ts-nocheck
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	avatarCacheDir,
	imagingCacheKey,
	readImagingCache,
	writeImagingCache,
} from "./imager-cache";

const TEST_KEY = imagingCacheKey("test-render");
const TEST_DIR = () => `${avatarCacheDir()}/unit`;

// One scratch root for the whole file. A per-test root (pid + Date.now()) left a
// new directory behind for every single test, which is how a hundred+ junk
// directories ended up in the runtime cache tree.
const SCRATCH_ROOT = `${process.cwd()}/storage/imaging/test-unit-${process.pid}`;

beforeEach(() => {
	// Isolate every run from the runtime cache and from prior runs.
	vi.stubEnv("IMAGING_CACHE_ROOT", SCRATCH_ROOT);
});

afterAll(async () => {
	await rm(SCRATCH_ROOT, { recursive: true, force: true });
});

describe("imagingCacheKey", () => {
	it("is stable and deterministic", () => {
		expect(imagingCacheKey("figure-a")).toBe(imagingCacheKey("figure-a"));
		expect(imagingCacheKey("figure-a")).not.toBe(imagingCacheKey("figure-b"));
	});
});

describe("readImagingCache / writeImagingCache", () => {
	it("round-trips a render", async () => {
		await writeImagingCache(
			TEST_DIR(),
			TEST_KEY,
			new Uint8Array([1, 2, 3]),
			"image/png",
		);
		const record = await readImagingCache(TEST_DIR(), TEST_KEY);
		expect(record).not.toBeNull();
		expect(record?.contentType).toBe("image/png");
		expect([...(record?.body ?? [])]).toEqual([1, 2, 3]);
	});

	it("returns null for a missing entry", async () => {
		expect(
			await readImagingCache(TEST_DIR(), imagingCacheKey("does-not-exist")),
		).toBeNull();
	});

	it("tolerates a torn write as a cache miss", async () => {
		const key = imagingCacheKey("torn-write");
		await writeImagingCache(
			TEST_DIR(),
			key,
			new Uint8Array([7, 7, 7]),
			"image/gif",
		);
		expect(await readImagingCache(TEST_DIR(), key)).not.toBeNull();
	});
});

describe("pruneImagingCache", () => {
	it("brings a directory that is over budget back down to its low-water mark", async () => {
		// The budget is read per sweep, so a test can make it small instead of
		// writing twenty thousand files.
		vi.stubEnv("IMAGING_CACHE_MAX_ENTRIES", "20");
		const dir = `${SCRATCH_ROOT}/prune-cap`;

		// Fill past the budget before the first write of this directory, because
		// that first write is the one that runs the sweep.
		await mkdir(dir, { recursive: true });
		for (let i = 0; i < 30; i++) {
			const name = imagingCacheKey(`figure-${String(i).padStart(3, "0")}`);
			await writeFile(join(dir, `${name}.img`), "x");
			await writeFile(join(dir, `${name}.json`), "{}");
		}

		// Every file is fresh, so an age-based sweep would not remove one of
		// them and the directory would keep growing. The write triggers a sweep.
		await writeImagingCache(
			dir,
			imagingCacheKey("trigger-sweep"),
			new Uint8Array([1]),
			"image/png",
		);

		// Back inside the budget: 20 * 0.9 = 18 survivors, plus the record the
		// triggering write just added. Records are counted as .img/.json pairs,
		// not as individual files.
		const remaining = (await readdir(dir)).filter((n) => n.endsWith(".img"));
		expect(remaining.length).toBeLessThanOrEqual(19);
		expect(remaining.length).toBeGreaterThan(0);

		// Newest survive, oldest go: the prune is least-recently-used, not random.
		expect(remaining).toContain(`${imagingCacheKey("figure-029")}.img`);
		expect(remaining).not.toContain(`${imagingCacheKey("figure-000")}.img`);

		// A pair is removed together, so no .json is left without its image.
		for (const image of remaining)
			expect(await readdir(dir)).toContain(
				`${image.replace(/\.img$/, "")}.json`,
			);
	});

	it("leaves a directory that is within budget alone", async () => {
		vi.stubEnv("IMAGING_CACHE_MAX_ENTRIES", "20");
		const dir = `${SCRATCH_ROOT}/prune-under-cap`;
		for (let i = 0; i < 5; i++) {
			await writeImagingCache(
				dir,
				imagingCacheKey(`kept-${i}`),
				new Uint8Array([i]),
				"image/png",
			);
		}
		const before = await readdir(dir);
		await writeImagingCache(
			dir,
			imagingCacheKey("another"),
			new Uint8Array([1]),
			"image/png",
		);
		// Only the new record was added; nothing that was already there was dropped.
		expect((await readdir(dir)).length).toBe(before.length + 2);
	});
});
