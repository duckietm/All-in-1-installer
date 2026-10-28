// @ts-nocheck
// @vitest-environment node
import { promises as fs } from "node:fs";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimePath } from "@/lib/utils/runtime-path";

const {
	appendFurniEntryMock,
	assetTargets,
	dbExecuteMock,
	getOrCreateCategoryPageMock,
} = vi.hoisted(() => ({
	appendFurniEntryMock: vi.fn(),
	assetTargets: {
		swfDir: "",
		iconDir: "",
		nitroDir: "",
		mirrorDirs: [] as Array<{
			swfDir: string;
			iconDir: string;
			nitroDir: string;
		}>,
	},
	dbExecuteMock: vi.fn(),
	getOrCreateCategoryPageMock: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	eq: vi.fn(() => ({})),
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
		strings,
		values,
	}),
}));

vi.mock("@/lib/db", async () => ({
	...(await import("@/test/db-helpers")).createDbHelpers(dbExecuteMock),
	ItemsBase: { id: "id", itemName: "item_name" },
	db: {
		execute: dbExecuteMock,
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => [],
				}),
			}),
		}),
	},
}));

vi.mock("@/lib/services/furni-asset-dirs", () => ({
	getFurniAssetDirs: vi.fn(async () => assetTargets),
	getFurniAssetWriteTargets: vi.fn(async () => assetTargets),
}));

vi.mock("@/lib/services/furni-data", () => ({
	appendFurniEntry: appendFurniEntryMock,
	buildFurniEntry: vi.fn(() => ({ id: 501 })),
}));

vi.mock("@/lib/services/furni-import", () => ({
	allocateCatalogItemId: vi.fn(
		async (insertFn: (nextId: number) => Promise<unknown>) => insertFn(701),
	),
	autoPriceFurni: vi.fn(() => ({ credits: 3, points: 0, pointsType: 0 })),
	CATEGORY_PAGE: {},
	classifyFurni: vi.fn(() => "other"),
	ensureDirectories: vi.fn(async () => {
		const dirs = [
			assetTargets.swfDir,
			assetTargets.iconDir,
			assetTargets.nitroDir,
			...assetTargets.mirrorDirs.flatMap((target) => [
				target.swfDir,
				target.iconDir,
				target.nitroDir,
			]),
		];
		await Promise.all(dirs.map((dir) => fs.mkdir(dir, { recursive: true })));
	}),
	getOrCreateCategoryPage: getOrCreateCategoryPageMock,
	IMPORTED_PAGE_CAPTION: "Imported Furniture",
	IMPORTED_PAGE_CAPTION_SAVE: "imported_furni",
}));

vi.mock("@/lib/services/swf/nitro-builder", () => ({
	parseNitroBundle: vi.fn(() => ({
		json: { xdim: 1, ydim: 1 },
		texture: Buffer.from("texture-bytes"),
		textureFileName: "chair.png",
	})),
	isLosslessWebp: vi.fn(() => false),
	toWebpLosslessBundle: vi.fn(() =>
		Promise.resolve(Buffer.from("webp-normalised", "utf-8")),
	),
}));

import {
	__resetUploadItemsBaseAllocatorForTests,
	uploadSingleFurni,
} from "./upload-import";

describe("uploadSingleFurni live asset mirrors", () => {
	let tempDir: string;

	beforeEach(async () => {
		__resetUploadItemsBaseAllocatorForTests();
		tempDir = await fs.mkdtemp(getRuntimePath(os.tmpdir(), "upload-furni-"));
		assetTargets.swfDir = getRuntimePath(tempDir, "cms", "swf");
		assetTargets.iconDir = getRuntimePath(tempDir, "cms", "icons");
		assetTargets.nitroDir = getRuntimePath(tempDir, "cms", "furniture");
		assetTargets.mirrorDirs = [
			{
				swfDir: assetTargets.swfDir,
				iconDir: getRuntimePath(tempDir, "Gamedata", "icons"),
				nitroDir: getRuntimePath(tempDir, "Gamedata", "bundled", "furniture"),
			},
		];
		dbExecuteMock.mockReset();
		dbExecuteMock
			.mockResolvedValueOnce([[{ next: 501 }], undefined])
			.mockResolvedValue(undefined);
		getOrCreateCategoryPageMock.mockResolvedValue("imp_other");
		appendFurniEntryMock.mockResolvedValue(undefined);
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	it("copies the bundle and icon into the directories served by production", async () => {
		const nitroBuffer = Buffer.from("nitro-bundle");
		const iconBuffer = Buffer.from("png-icon");

		const result = await uploadSingleFurni({
			classname: "chair",
			name: "Chair",
			itemType: "s",
			nitroBuffer,
			iconBuffer,
		});

		expect(result.ok).toBe(true);
		// Uploads land as `.hab` — the extension the client requests.
		await expect(
			fs.readFile(
				getRuntimePath(assetTargets.mirrorDirs[0].nitroDir, "chair.hab"),
			),
		).resolves.toEqual(Buffer.from("webp-normalised", "utf-8"));
		await expect(
			fs.readFile(
				getRuntimePath(assetTargets.mirrorDirs[0].iconDir, "chair_icon.png"),
			),
		).resolves.toEqual(iconBuffer);
	});

	// A `.hab` and a `.nitro` are the same bundle, so the uploaded file's own
	// extension only decides the name on disk — never whether it is accepted.
	it("stores a `.nitro` upload as `.hab` too", async () => {
		const result = await uploadSingleFurni({
			classname: "chair",
			name: "Chair",
			itemType: "s",
			nitroBuffer: Buffer.from("nitro-bundle"),
		});

		expect(result.ok).toBe(true);
		await expect(
			fs.readFile(getRuntimePath(assetTargets.nitroDir, "chair.hab")),
		).resolves.toEqual(Buffer.from("webp-normalised", "utf-8"));
		await expect(
			fs.stat(getRuntimePath(assetTargets.nitroDir, "chair.nitro")),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	// Writing `.hab` beside a live `.nitro` would leave the client two bundles
	// to choose between, so the import has to refuse instead.
	it("refuses to overwrite a legacy `.nitro` already on disk", async () => {
		await fs.mkdir(assetTargets.nitroDir, { recursive: true });
		await fs.writeFile(
			getRuntimePath(assetTargets.nitroDir, "chair.nitro"),
			"existing",
		);

		const result = await uploadSingleFurni({
			classname: "chair",
			name: "Chair",
			itemType: "s",
			nitroBuffer: Buffer.from("nitro-bundle"),
		});

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/chair\.nitro already exists on disk/);
		await expect(
			fs.readFile(getRuntimePath(assetTargets.nitroDir, "chair.nitro")),
		).resolves.toEqual(Buffer.from("existing"));
	});
});
