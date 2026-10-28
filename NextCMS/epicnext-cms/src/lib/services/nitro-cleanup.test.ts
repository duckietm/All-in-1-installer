// @ts-nocheck
// @vitest-environment node
import { createHash } from "node:crypto";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SCAN_CACHE_FILE = path.join(
	process.cwd(),
	"storage",
	"nitro-cleanup",
	"scan-cache.json",
);

type AnyFn = (...args: any[]) => any;

const {
	executeFn,
	readdirFn,
	readFileFn,
	statFn,
	unlinkFn,
	writeFileFn,
	mkdirFn,
	existsFn,
	parseNitroBundle,
	getTargetsFn,
	listSourcesFn,
	downloadFileFn,
} = vi.hoisted(() => ({
	executeFn: vi.fn<AnyFn>(async () => [
		[
			{ item_name: "chair", public_name: "Chair" },
			{ item_name: "broken_thing", public_name: "Broken Thing" },
			{ item_name: "xmas_*1", public_name: "Xmas" },
		],
		[],
	]),
	readdirFn: vi.fn<AnyFn>(),
	readFileFn: vi.fn<AnyFn>(),
	statFn: vi.fn<AnyFn>(),
	unlinkFn: vi.fn<AnyFn>(async () => {}),
	writeFileFn: vi.fn<AnyFn>(async () => {}),
	mkdirFn: vi.fn<AnyFn>(async () => {}),
	existsFn: vi.fn<AnyFn>(() => false),
	parseNitroBundle: vi.fn<AnyFn>(),
	getTargetsFn: vi.fn<AnyFn>(async () => ({
		nitroDir: "/assets/nitro",
		swfDir: "/assets/swf",
		iconDir: "/assets/icons",
		mirrorDirs: [],
	})),
	listSourcesFn: vi.fn<AnyFn>(async () => [
		{
			id: "test",
			name: "Test Source",
			furnidataUrl: "https://src.test/gamedata/FurnitureData.json",
			nitroBaseUrl: "https://src.test/nitro",
			iconBaseUrl: "https://src.test/icons",
			hotel: "nl",
		},
	]),
	downloadFileFn: vi.fn<AnyFn>(async () => ({ ok: true, size: 100 })),
}));

vi.mock("@/lib/db", async () => ({
	...(await import("@/test/db-helpers")).createDbHelpers(executeFn),
	db: { execute: executeFn },
}));
vi.mock("@/lib/services/furni-asset-dirs", () => ({
	getFurniAssetWriteTargets: getTargetsFn,
}));
vi.mock("@/lib/services/swf/nitro-builder", () => ({ parseNitroBundle }));
vi.mock("@/lib/services/clone-sources", () => ({
	listSources: listSourcesFn,
	DEFAULT_NITRO_SOURCES: [],
}));
vi.mock("@/lib/services/import/core/download", () => ({
	downloadFile: downloadFileFn,
}));
vi.mock("node:fs", async (orig) => {
	const real = (await orig()) as typeof import("node:fs");
	return {
		...real,
		promises: {
			...real.promises,
			readdir: readdirFn as AnyFn,
			readFile: readFileFn as AnyFn,
			stat: statFn as AnyFn,
			unlink: unlinkFn as AnyFn,
			writeFile: writeFileFn as AnyFn,
			mkdir: mkdirFn as AnyFn,
		},
		existsSync: existsFn,
	};
});

import {
	autoCleanFakeNitros,
	deleteNitroCleanupFiles,
	getPersistedCleanupResult,
	type NitroRepairProgress,
	refreshScanCacheAfterMutation,
	repairBrokenNitros,
	scanFakeBrokenNitros,
} from "@/lib/services/nitro-cleanup";
import {
	cancelActiveScan,
	cancelScanSession,
	NitroScanConflictError,
	readScanSession,
	runScanInBackground,
	writeScanSession,
} from "@/lib/services/nitro-scan-session";

beforeEach(() => {
	vi.clearAllMocks();
	readdirFn.mockReset();
	readFileFn.mockReset();
	parseNitroBundle.mockReset();
	existsFn.mockReset();
	getTargetsFn.mockReset();
	listSourcesFn.mockReset();
	downloadFileFn.mockReset();
	unlinkFn.mockReset();
	unlinkFn.mockImplementation(async () => {});
	writeFileFn.mockReset();
	writeFileFn.mockImplementation(async () => {});
	mkdirFn.mockReset();
	mkdirFn.mockImplementation(async () => {});
	getTargetsFn.mockResolvedValue({
		nitroDir: "/assets/nitro",
		swfDir: "/assets/swf",
		iconDir: "/assets/icons",
		mirrorDirs: [],
	});
	listSourcesFn.mockResolvedValue([
		{
			id: "test",
			name: "Test Source",
			furnidataUrl: "https://src.test/gamedata/FurnitureData.json",
			nitroBaseUrl: "https://src.test/nitro",
			iconBaseUrl: "https://src.test/icons",
			hotel: "nl",
		},
	]);
	downloadFileFn.mockResolvedValue({ ok: true, size: 100 });
	statFn.mockImplementation(async () => ({ size: 512, mtimeMs: 0 }));
});

/**
 * File-backed state for the mocked `node:fs` promises: cache/session/history
 * writes land in the map and subsequent reads/exists checks consult it, while
 * binary reads (nitro bundles) fall back to placeholder bytes.
 */
function installFileState(
	initial: Record<string, string> = {},
): Map<string, string> {
	const files = new Map<string, string>(Object.entries(initial));
	readFileFn.mockImplementation(async (filePath: string) => {
		const stored = files.get(filePath);
		if (stored !== undefined) return stored;
		return Buffer.from("nitro-data");
	});
	writeFileFn.mockImplementation(async (filePath: string, data: unknown) => {
		files.set(
			filePath,
			Buffer.isBuffer(data) ? data.toString("utf-8") : String(data),
		);
	});
	existsFn.mockImplementation((filePath: string) => files.has(filePath));
	return files;
}

async function waitForSessionState(
	expected: string,
	timeoutMs = 2000,
): Promise<Awaited<ReturnType<typeof readScanSession>>> {
	const deadline = Date.now() + timeoutMs;
	let session = await readScanSession();
	while ((session?.state ?? null) !== expected && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 5));
		session = await readScanSession();
	}
	return session;
}

/** Let a detached scan from the previous test settle before the next one. */
async function settleDetachedScans(): Promise<void> {
	cancelActiveScan();
	await new Promise((resolve) => setTimeout(resolve, 20));
}

function mockReaddir(byDir: Record<string, string[]>): void {
	readdirFn.mockImplementation(async (dir: string) => byDir[dir] ?? []);
}

/** Replicates `dirNameSignature` in the service so cache fixtures match. */
function dirSignature(names: string[]): string {
	const hash = createHash("sha1");
	for (const name of names) hash.update(name).update("\n");
	return hash.digest("hex");
}

describe("scanFakeBrokenNitros", () => {
	it("classifies fake (no matching item) and broken (unparseable) bundles", async () => {
		mockReaddir({
			"/assets/nitro": [
				"chair.nitro",
				"fake_stuff.nitro",
				"broken_thing.nitro",
				"xmas_.nitro",
			],
		});
		readFileFn.mockImplementation(async (filePath: string) =>
			Buffer.from(filePath.includes("broken") ? "broken-data" : "nitro-data"),
		);
		parseNitroBundle.mockImplementation((buffer: Buffer) => {
			if (buffer.toString("utf-8").startsWith("broken")) {
				throw new Error("Not a valid .nitro bundle");
			}
			return {
				json: {},
				jsonFileName: "visualization.json",
				png: Buffer.alloc(0),
				pngFileName: "texture.png",
			};
		});

		const result = await scanFakeBrokenNitros();

		expect(result.fake.map((e) => e.fileName)).toEqual(["fake_stuff.nitro"]);
		expect(result.broken.map((e) => e.fileName)).toEqual([
			"broken_thing.nitro",
		]);
		expect(result.broken[0].error).toBe("Not a valid .nitro bundle");
	});

	it("resolves star classnames to their base nitro stem", async () => {
		mockReaddir({ "/assets/nitro": ["xmas_.nitro"] });
		readFileFn.mockResolvedValue(Buffer.from("nitro-data"));
		parseNitroBundle.mockReturnValue({
			json: {},
			jsonFileName: "visualization.json",
			png: Buffer.alloc(0),
			pngFileName: "texture.png",
		});

		const result = await scanFakeBrokenNitros();

		expect(result.fake).toEqual([]);
		expect(result.broken).toEqual([]);
		expect(result.total).toBe(1);
	});

	it("marks an unparseable bundle whose item is also missing as fake", async () => {
		mockReaddir({ "/assets/nitro": ["ghost.nitro"] });

		const result = await scanFakeBrokenNitros();

		expect(result.fake[0].fileName).toBe("ghost.nitro");
		expect(result.broken).toEqual([]);
	});

	it("reports orphaned swf and icon files alongside nitro leftovers", async () => {
		mockReaddir({
			"/assets/nitro": ["chair.nitro", "ghost.nitro"],
			"/assets/swf": ["chair.swf", "phantom.swf"],
			"/assets/icons": ["chair.gif", "phantom.gif", "phantom.png"],
		});

		const result = await scanFakeBrokenNitros();

		expect(result.fake.map((e) => e.fileName)).toEqual(["ghost.nitro"]);
		expect(result.orphanedSwf.map((e) => e.fileName)).toEqual(["phantom.swf"]);
		expect(result.orphanedIcon.map((e) => e.fileName)).toEqual([
			"phantom.gif",
			"phantom.png",
		]);
		expect(result.total).toBe(7);
	});

	it("records the largest size and latest mtime across mirrored copies", async () => {
		getTargetsFn.mockResolvedValue({
			nitroDir: "/a/nitro",
			swfDir: "/a/swf",
			iconDir: "/a/icons",
			mirrorDirs: [
				{ nitroDir: "/b/nitro", swfDir: "/b/swf", iconDir: "/b/icons" },
			],
		});
		mockReaddir({ "/a/nitro": ["ghost.nitro"], "/b/nitro": ["ghost.nitro"] });
		statFn.mockImplementation(async (filePath: string) =>
			filePath.startsWith("/a/")
				? { size: 100, mtimeMs: 1000 }
				: { size: 900, mtimeMs: 2000 },
		);
		readFileFn.mockResolvedValue(Buffer.from("nitro-data"));
		parseNitroBundle.mockReturnValue({});

		const result = await scanFakeBrokenNitros();

		expect(result.total).toBe(1);
		expect(result.fake[0].dirs).toEqual(["/a/nitro", "/b/nitro"]);
		expect(result.fake[0].size).toBe(900);
		expect(result.fake[0].lastModified).toBe(2000);
	});

	it("serves results from the on-disk cache when directories are unchanged", async () => {
		mockReaddir({
			"/assets/nitro": ["chair.nitro", "ghost.nitro"],
		});
		const dirs = {
			"nitro\u0000/assets/nitro": dirSignature(["chair.nitro", "ghost.nitro"]),
			"swf\u0000/assets/swf": dirSignature([]),
			"icon\u0000/assets/icons": dirSignature([]),
		};
		const cachedResult = {
			fake: [
				{
					fileName: "ghost.nitro",
					base: "ghost",
					size: 500,
					dirs: ["/assets/nitro"],
					lastModified: 0,
					error: undefined,
				},
			],
			broken: [],
			orphanedSwf: [],
			orphanedIcon: [],
			total: 4,
		};
		existsFn.mockImplementation((filePath: string) =>
			filePath.includes("scan-cache.json"),
		);
		readFileFn.mockImplementation(async (filePath: string) => {
			if (filePath.includes("scan-cache.json")) {
				return JSON.stringify({ dirs, result: cachedResult });
			}
			return Buffer.from("nitro-data");
		});

		const result = await scanFakeBrokenNitros();

		// `total: 4` could never come from a fresh scan of 2 files — the cache
		// result came back verbatim, so classification was skipped entirely.
		expect(result).toEqual(expect.objectContaining(cachedResult));
		expect(result.cached).toBe(true);
		expect(result.total).toBe(4);
		expect(executeFn).not.toHaveBeenCalled();
		expect(statFn).not.toHaveBeenCalled();
		expect(readFileFn).toHaveBeenCalledTimes(1);
		expect(writeFileFn).not.toHaveBeenCalled();
	});

	it("force bypasses the cache and re-validates the directories", async () => {
		mockReaddir({
			"/assets/nitro": ["chair.nitro", "ghost.nitro"],
		});
		// A matching-on-disk cache exists, but `force: true` ignores it.
		existsFn.mockImplementation(() => true);
		readFileFn.mockResolvedValue(Buffer.from("nitro-data"));
		parseNitroBundle.mockReturnValue({});
		statFn.mockImplementation(async () => ({ size: 512, mtimeMs: 0 }));

		const result = await scanFakeBrokenNitros({ force: true });

		expect(result.cached).toBeUndefined();
		expect(result.fake.map((e) => e.fileName)).toEqual(["ghost.nitro"]);
		expect(result.broken).toEqual([]);
		expect(result.total).toBe(2);
		expect(statFn).toHaveBeenCalled();
	});
});

describe("deleteNitroCleanupFiles", () => {
	beforeEach(() => {
		getTargetsFn.mockResolvedValue({
			nitroDir: "/a/nitro",
			swfDir: "/a/swf",
			iconDir: "/a/icons",
			mirrorDirs: [
				{ nitroDir: "/b/nitro", swfDir: "/b/swf", iconDir: "/b/icons" },
			],
		});
		existsFn.mockImplementation((filePath: string) =>
			filePath.includes("chair"),
		);
	});

	it("removes each file from every directory where it exists", async () => {
		const result = await deleteNitroCleanupFiles([
			"chair.nitro",
			"missing.nitro",
		]);

		expect(result.deleted).toBe(1);
		expect(result.copiesRemoved).toBe(2);
		expect(unlinkFn).toHaveBeenCalledTimes(2);
		expect(unlinkFn).toHaveBeenCalledWith("/a/nitro/chair.nitro");
		expect(unlinkFn).toHaveBeenCalledWith("/b/nitro/chair.nitro");
		expect(result.errors).toEqual([]);
		const chair = result.files.find((f) => f.fileName === "chair.nitro");
		expect(chair?.deleted).toBe(true);
		expect(chair?.remaining).toEqual([]);
	});

	it("keeps a file in remaining dirs when an unlink fails", async () => {
		unlinkFn.mockImplementation(async (filePath: string) => {
			if (filePath.startsWith("/b/")) throw new Error("locked");
		});

		const result = await deleteNitroCleanupFiles(["chair.nitro"]);

		expect(result.deleted).toBe(0);
		expect(result.copiesRemoved).toBe(1);
		expect(result.errors.some((e) => e.includes("locked"))).toBe(true);
		const chair = result.files.find((f) => f.fileName === "chair.nitro");
		expect(chair?.deleted).toBe(false);
		expect(chair?.remaining).toEqual(["/b/nitro"]);
	});

	it("rejects unsafe file names", async () => {
		const result = await deleteNitroCleanupFiles(["../evil.nitro"]);

		expect(result.deleted).toBe(0);
		expect(result.errors[0]).toContain("Invalid nitro file name");
		expect(unlinkFn).not.toHaveBeenCalled();
	});

	it("deletes swf and icon files from their own directories", async () => {
		existsFn.mockImplementation((filePath: string) =>
			filePath.includes("phantom"),
		);

		const swfResult = await deleteNitroCleanupFiles(["phantom.swf"], "swf");
		const iconResult = await deleteNitroCleanupFiles(["phantom.gif"], "icon");

		expect(swfResult.copiesRemoved).toBe(2);
		expect(unlinkFn).toHaveBeenCalledWith("/a/swf/phantom.swf");
		expect(unlinkFn).toHaveBeenCalledWith("/b/swf/phantom.swf");
		expect(iconResult.copiesRemoved).toBe(2);
		expect(unlinkFn).toHaveBeenCalledWith("/a/icons/phantom.gif");
		expect(unlinkFn).toHaveBeenCalledWith("/b/icons/phantom.gif");
	});

	it("rejects a swf name for the icon kind", async () => {
		const result = await deleteNitroCleanupFiles(["phantom.gif"], "swf");
		expect(result.deleted).toBe(0);
		expect(result.errors[0]).toContain("Invalid swf file name");
		expect(unlinkFn).not.toHaveBeenCalled();
	});
});

describe("autoCleanFakeNitros", () => {
	it("removes only fake leftovers older than the age threshold", async () => {
		getTargetsFn.mockResolvedValue({
			nitroDir: "/a/nitro",
			swfDir: "/a/swf",
			iconDir: "/a/icons",
			mirrorDirs: [],
		});
		mockReaddir({
			"/a/nitro": [
				"old_fake.nitro",
				"chair.nitro",
				"recent_fake.nitro",
				"broken_thing.nitro",
			],
		});
		const now = Date.now();
		statFn.mockImplementation(async (filePath: string) => ({
			size: 10,
			mtimeMs: filePath.includes("old_fake")
				? now - 60 * 24 * 60 * 60 * 1000
				: now,
		}));
		existsFn.mockImplementation(() => true);
		readFileFn.mockResolvedValue(Buffer.from("broken-data"));
		parseNitroBundle.mockImplementation(() => {
			throw new Error("Not a valid .nitro bundle");
		});

		const result = await autoCleanFakeNitros(30);

		expect(result.deleted).toBe(1);
		expect(result.copiesRemoved).toBe(1);
		expect(unlinkFn).toHaveBeenCalledWith("/a/nitro/old_fake.nitro");
		expect(result.skippedRecent).toBe(1);
		expect(result.skippedBroken).toBe(2);
	});
});

describe("refreshScanCacheAfterMutation", () => {
	it("drops removed files and recomputes digests so the cache stays valid", async () => {
		const dirs = {
			"nitro\u0000/assets/nitro": dirSignature(["chair.nitro", "ghost.nitro"]),
			"swf\u0000/assets/swf": dirSignature([]),
			"icon\u0000/assets/icons": dirSignature([]),
		};
		const files = installFileState({
			[SCAN_CACHE_FILE]: JSON.stringify({
				dirs,
				result: {
					fake: [
						{
							fileName: "ghost.nitro",
							base: "ghost",
							size: 500,
							dirs: ["/assets/nitro"],
							lastModified: 0,
						},
					],
					broken: [],
					orphanedSwf: [],
					orphanedIcon: [],
					total: 2,
				},
			}),
		});
		// The directory changed after the cached scan (ghost.nitro deleted).
		readdirFn.mockImplementation(async (dir: string) =>
			dir.endsWith("/nitro") ? ["chair.nitro"] : [],
		);

		await refreshScanCacheAfterMutation("nitro", ["ghost.nitro"], 1);

		const written = JSON.parse(files.get(SCAN_CACHE_FILE) as string) as {
			dirs: Record<string, string>;
			result: {
				fake: Array<{ fileName: string }>;
				broken: unknown[];
				orphanedSwf: unknown[];
				orphanedIcon: unknown[];
				total: number;
			};
		};
		expect(written.dirs["nitro\u0000/assets/nitro"]).toBe(
			dirSignature(["chair.nitro"]),
		);
		expect(written.result.fake).toEqual([]);
		expect(written.result.total).toBe(1);
		// The persisted result is now the refreshed one.
		await expect(getPersistedCleanupResult()).resolves.toMatchObject({
			fake: [],
			total: 1,
		});
	});

	it("is a no-op when the file names list is empty or no cache exists", async () => {
		installFileState({});
		await refreshScanCacheAfterMutation("nitro", [], 0);
		installFileState({});
		await refreshScanCacheAfterMutation("nitro", ["ghost.nitro"], 1);
		expect(writeFileFn).not.toHaveBeenCalled();
	});
});

describe("scan aborting", () => {
	it("throws an AbortError and skips the scan cache write when aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		await expect(
			scanFakeBrokenNitros({ signal: controller.signal }),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(writeFileFn).not.toHaveBeenCalled();
		expect(readFileFn).not.toHaveBeenCalled();
	});
});

describe("nitro-scan-session", () => {
	it("runs a scan in the background and persists the done session", async () => {
		await settleDetachedScans();
		installFileState({});
		readdirFn.mockImplementation(async (dir: string) =>
			dir.endsWith("/nitro") ? ["chair.nitro"] : [],
		);
		parseNitroBundle.mockReturnValue({});
		statFn.mockImplementation(async () => ({ size: 512, mtimeMs: 0 }));

		const session = await runScanInBackground({ force: true });

		expect(session.id).toBeTruthy();
		const done = await waitForSessionState("done");
		expect(done?.id).toBe(session.id);
		expect(done?.total).toBe(1);
		expect(done?.cached).toBe(false);
	});

	it("rejects a second scan while a fresh one is running (single-flight)", async () => {
		await settleDetachedScans();
		installFileState({});
		readdirFn.mockImplementation(async (dir: string) =>
			dir.endsWith("/nitro") ? ["chair.nitro"] : [],
		);
		parseNitroBundle.mockReturnValue({});

		await runScanInBackground({ force: false });
		await expect(runScanInBackground({ force: false })).rejects.toBeInstanceOf(
			NitroScanConflictError,
		);

		await settleDetachedScans();
	});

	it("lets a stale running session be taken over (crashed process recovery)", async () => {
		await settleDetachedScans();
		installFileState({});
		readdirFn.mockImplementation(async (dir: string) =>
			dir.endsWith("/nitro") ? ["chair.nitro"] : [],
		);
		parseNitroBundle.mockReturnValue({});
		const staleHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
		await writeScanSession({
			id: "stale-session",
			state: "running",
			startedAt: staleHourAgo,
			updatedAt: staleHourAgo,
			force: false,
		});

		const session = await runScanInBackground({ force: false });

		expect(session.id).not.toBe("stale-session");
		await expect(waitForSessionState("done")).resolves.toMatchObject({
			id: session.id,
		});
	});

	it("marks the session cancelled when the scan is aborted", async () => {
		await settleDetachedScans();
		installFileState({});
		readdirFn.mockImplementation(async (dir: string) =>
			dir.endsWith("/nitro") ? ["chair.nitro"] : [],
		);
		parseNitroBundle.mockReturnValue({});

		const session = await runScanInBackground({ force: false });
		const cancelled = await cancelScanSession();

		expect(cancelled?.state).toBe("cancelled");
		await expect(waitForSessionState("cancelled")).resolves.toMatchObject({
			id: session.id,
		});
	});
});

describe("repairBrokenNitros", () => {
	it("re-downloads valid bundles and writes them to every nitro dir", async () => {
		getTargetsFn.mockResolvedValue({
			nitroDir: "/a/nitro",
			swfDir: "/a/swf",
			iconDir: "/a/icons",
			mirrorDirs: [],
		});
		readFileFn.mockResolvedValue(Buffer.from("nitro-data"));
		parseNitroBundle.mockReturnValue({});

		const result = await repairBrokenNitros(["broken_thing.nitro"]);

		expect(result.repaired).toBe(1);
		expect(result.failed).toBe(0);
		expect(downloadFileFn).toHaveBeenCalledWith(
			"https://src.test/nitro/broken_thing.nitro",
			expect.any(String),
			expect.objectContaining({ validate: "nitro" }),
		);
		expect(writeFileFn).toHaveBeenCalledWith(
			expect.stringContaining("/a/nitro/broken_thing.nitro"),
			expect.any(Buffer),
		);
	});

	it("rejects unsafe file names without downloading", async () => {
		const result = await repairBrokenNitros(["../evil.nitro"]);

		expect(result.repaired).toBe(0);
		expect(result.failed).toBe(1);
		expect(downloadFileFn).not.toHaveBeenCalled();
	});

	// `.hab` is accepted as a bundle name now, so it has to clear exactly the
	// same traversal guard as `.nitro` — stripping an extension is not a check.
	it("rejects unsafe `.hab` file names without downloading", async () => {
		const result = await repairBrokenNitros(["../evil.hab"]);

		expect(result.repaired).toBe(0);
		expect(result.failed).toBe(1);
		expect(downloadFileFn).not.toHaveBeenCalled();
	});

	it("re-downloads a broken `.hab` and writes it back under the same name", async () => {
		getTargetsFn.mockResolvedValue({
			nitroDir: "/a/nitro",
			swfDir: "/a/swf",
			iconDir: "/a/icons",
			mirrorDirs: [],
		});
		readFileFn.mockResolvedValue(Buffer.from("nitro-data"));
		parseNitroBundle.mockReturnValue({});
		downloadFileFn.mockResolvedValue({ ok: true, size: 512 });

		const result = await repairBrokenNitros(["broken_thing.hab"]);

		expect(result.repaired).toBe(1);
		// Sources still serve `.nitro`; the local file keeps its own name.
		expect(downloadFileFn).toHaveBeenCalledWith(
			"https://src.test/nitro/broken_thing.nitro",
			expect.any(String),
			expect.objectContaining({ validate: "nitro" }),
		);
		expect(writeFileFn).toHaveBeenCalledWith(
			expect.stringContaining("/a/nitro/broken_thing.hab"),
			expect.any(Buffer),
		);
	});

	it("fails when no source can provide the bundle", async () => {
		downloadFileFn.mockResolvedValue({ ok: false, size: 0, error: "HTTP 404" });

		const result = await repairBrokenNitros(["broken_thing.nitro"]);

		expect(result.repaired).toBe(0);
		expect(result.failed).toBe(1);
		expect(result.errors[0]).toMatch(/could not re-obtain/);
	});

	it("reports per-bundle progress while re-downloading", async () => {
		getTargetsFn.mockResolvedValue({
			nitroDir: "/a/nitro",
			swfDir: "/a/swf",
			iconDir: "/a/icons",
			mirrorDirs: [],
		});
		readFileFn.mockResolvedValue(Buffer.from("nitro-data"));
		parseNitroBundle.mockReturnValue({});
		downloadFileFn.mockResolvedValue({ ok: true, size: 100 });

		const events: NitroRepairProgress[] = [];
		const result = await repairBrokenNitros(["a.nitro", "b.nitro"], {
			onProgress: (progress) => events.push(progress),
		});

		expect(result.repaired).toBe(2);
		expect(events).toHaveLength(2);
		expect(events.map((e) => e.completed).sort()).toEqual([1, 2]);
		expect(events[events.length - 1]).toMatchObject({
			total: 2,
			ok: 2,
			failed: 0,
		});
		expect(events[0].total).toBe(2);
	});

	it("counts successes and failures in repair progress", async () => {
		getTargetsFn.mockResolvedValue({
			nitroDir: "/a/nitro",
			swfDir: "/a/swf",
			iconDir: "/a/icons",
			mirrorDirs: [],
		});
		readFileFn.mockResolvedValue(Buffer.from("nitro-data"));
		parseNitroBundle.mockReturnValue({});
		downloadFileFn.mockImplementation(async (url: string) => ({
			ok: url.includes("a.nitro"),
			size: 100,
			error: url.includes("b.nitro") ? "HTTP 404" : undefined,
		}));

		const events: NitroRepairProgress[] = [];
		await repairBrokenNitros(["a.nitro", "b.nitro"], {
			onProgress: (progress) => events.push(progress),
		});

		expect(events.map((e) => e.completed).sort()).toEqual([1, 2]);
		expect(events[events.length - 1]).toMatchObject({
			total: 2,
			ok: 1,
			failed: 1,
		});
	});
});
