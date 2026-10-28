// @ts-nocheck
import { createHash } from "node:crypto";

vi.mock("@/lib/services/figuredata", () => ({
	getFigureDataPath: async () =>
		path.join(await mocks.gamedata(), "custom/FigureData.json"),
}));
vi.mock("@/lib/services/figuremap", () => ({
	getFigureMapPath: async () =>
		path.join(await mocks.gamedata(), "custom/FigureMap.json"),
}));
vi.mock("@/lib/services/effectmap", () => ({
	getEffectMapPath: async () =>
		path.join(await mocks.gamedata(), "custom/EffectMap.json"),
}));

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	commit: vi.fn(),
	rollback: vi.fn(),
	release: vi.fn(),
	gamedata: vi.fn(),
	dirs: vi.fn(),
	data: vi.fn(),
	settings: vi.fn(),
	publicRoot: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
	db: { $client: { getConnection: async () => mocks } },
}));
vi.mock("@/lib/services/furni-asset-dirs", () => ({
	getGamedataRoot: mocks.gamedata,
	getFurniAssetDirs: mocks.dirs,
}));
vi.mock("@/lib/services/furni-data", () => ({
	getFurnitureDataPath: mocks.data,
}));
vi.mock("@/lib/services/public-asset-root", () => ({
	getPublicAssetRoot: mocks.publicRoot,
}));
vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { get: mocks.settings },
}));

import { createCatalogSnapshot } from "./catalog-git-snapshot";

describe("catalog snapshot", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.settings.mockResolvedValue("");
		mocks.query.mockImplementation(async (sql: string) => {
			if (sql === "SHOW TABLES")
				return [
					[
						{ name: "items_base" },
						{ name: "catalog_pages" },
						{ name: "catalog_items" },
					],
				];
			if (sql.startsWith("SHOW CREATE"))
				return [
					[
						{
							"Create Table":
								"CREATE TABLE `test` (`id` int PRIMARY KEY, `name` text) ENGINE=InnoDB",
						},
					],
				];
			if (sql.startsWith("SHOW COLUMNS"))
				return [
					[
						{ Field: "id", Extra: "" },
						{ Field: "name", Extra: "" },
					],
				];
			if (sql.startsWith("SELECT"))
				return [[{ id: 1, name: "Valentine's chair" }]];
			return [[]];
		});
	});
	async function fixture() {
		const root = await mkdtemp(path.join(os.tmpdir(), "catalog-snapshot-"));
		for (const folder of [
			"config",
			"custom",
			"icons",
			"bundled/furniture",
			"c_images/catalogue",
			"output",
		])
			await mkdir(path.join(root, folder), { recursive: true });
		await writeFile(
			path.join(root, "config/FurnitureData.json"),
			'{"roomitemtypes":{"furnitype":[]}}',
		);
		await writeFile(path.join(root, "config/FurnitureData_it.json"), "{}");
		await writeFile(
			path.join(root, "config/private-cache.json"),
			'{"secret":"not exported"}',
		);
		await writeFile(path.join(root, "icons/chair_icon.png"), "image");
		await writeFile(path.join(root, "bundled/furniture/chair.nitro"), "bundle");
		await writeFile(
			path.join(root, "c_images/catalogue/icon_1.png"),
			"catalog icon",
		);
		await writeFile(
			path.join(root, "custom/FigureData.json"),
			'{"configured":true}',
		);
		await writeFile(path.join(root, "custom/FigureMap.json"), "{}");
		await writeFile(path.join(root, "custom/EffectMap.json"), "{}");
		mocks.gamedata.mockResolvedValue(root);
		mocks.publicRoot.mockReturnValue(root);
		mocks.dirs.mockResolvedValue({
			nitroDir: path.join(root, "bundled/furniture"),
			iconDir: path.join(root, "icons"),
		});
		mocks.data.mockResolvedValue(path.join(root, "config/FurnitureData.json"));
		return root;
	}
	it("includes bundles, both icon types, translations and SQL but excludes private caches", async () => {
		const root = await fixture();
		const files = await createCatalogSnapshot(path.join(root, "output"));
		const targets = files.map((f) => f.target);
		const manifestFile = files.find(
			(file) => file.target === "Gamedata/catalog-release.json",
		);
		expect(manifestFile).toBeDefined();
		if (!manifestFile) throw new Error("Missing manifest");
		const manifest = JSON.parse(await readFile(manifestFile.source, "utf8"));
		expect(manifest.files).toHaveLength(files.length - 1);
		expect(
			manifest.files.some((file: { path: string }) =>
				file.path.endsWith("items_base.sql"),
			),
		).toBe(true);
		for (const file of files.filter((file) => file !== manifestFile)) {
			const bytes = await readFile(file.source);
			expect(manifest.files).toContainEqual({
				path: file.target,
				bytes: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			});
		}
		expect(targets).toContain("Gamedata/bundled/furniture/chair.nitro");
		expect(targets).toContain("Gamedata/icons/chair_icon.png");
		expect(targets).toContain("Gamedata/c_images/catalogue/icon_1.png");
		expect(targets).toContain(
			"catalogue version 2 ( Final (Dev)/langs furnidata/FurnitureData_it.json",
		);
		expect(targets.some((t) => t.includes("private-cache"))).toBe(false);
		expect(targets.filter((t) => t.endsWith(".sql"))).toHaveLength(3);
		const sqlFile = files.find((f) => f.target.endsWith("/items_base.sql"));
		expect(sqlFile).toBeDefined();
		expect(await readFile(sqlFile?.source ?? "", "utf8")).toContain(
			"ON DUPLICATE KEY UPDATE",
		);
		const figure = files.find(
			(f) => f.target === "Gamedata/config/FigureData.json",
		);
		expect(figure).toBeDefined();
		expect(await readFile(figure?.source ?? "", "utf8")).toContain(
			'"configured":true',
		);
		expect(targets).toContain("Gamedata/config/FigureMap.json");
		expect(targets).toContain("Gamedata/config/EffectMap.json");
		expect(mocks.commit).toHaveBeenCalledOnce();
		expect(mocks.release).toHaveBeenCalledOnce();
	});
	it("rejects invalid JSON before publishing and releases failed SQL snapshots", async () => {
		const root = await fixture();
		mocks.query.mockRejectedValueOnce(new Error("DB unavailable"));
		await expect(
			createCatalogSnapshot(path.join(root, "output")),
		).rejects.toThrow("DB unavailable");
		expect(mocks.rollback).toHaveBeenCalledOnce();
		expect(mocks.release).toHaveBeenCalledOnce();
		await writeFile(path.join(root, "config/FurnitureData.json"), "{");
		await expect(
			createCatalogSnapshot(path.join(root, "output")),
		).rejects.toThrow();
	});
	it("uses one consistent SQL transaction and rejects sources changed during capture", async () => {
		const root = await fixture();
		const original = mocks.query.getMockImplementation();
		if (!original) throw new Error("Missing query fixture");
		mocks.query.mockImplementation(async (sql: string) => {
			if (sql.startsWith("SELECT") && sql.includes("items_base")) {
				await writeFile(
					path.join(root, "icons/chair_icon.png"),
					"changed image",
				);
			}
			return original(sql);
		});
		await expect(
			createCatalogSnapshot(path.join(root, "output")),
		).rejects.toThrow("Assets changed");
		const queries = mocks.query.mock.calls.map(([sql]) => sql);
		expect(
			queries.filter((sql) => sql.startsWith("START TRANSACTION")),
		).toEqual(["START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"]);
		expect(queries.filter((sql) => sql.startsWith("SELECT"))).toHaveLength(3);
	});
	it("rejects nontransactional tables instead of advertising a consistent database snapshot", async () => {
		const root = await fixture();
		const original = mocks.query.getMockImplementation();
		if (!original) throw new Error("Missing query fixture");
		mocks.query.mockImplementation(async (sql: string) =>
			sql.startsWith("SHOW CREATE")
				? [[{ "Create Table": "CREATE TABLE `test` (`id` int) ENGINE=MyISAM" }]]
				: original(sql),
		);
		await expect(
			createCatalogSnapshot(path.join(root, "output")),
		).rejects.toThrow("InnoDB");
		expect(mocks.rollback).toHaveBeenCalledOnce();
		expect(mocks.release).toHaveBeenCalledOnce();
	});
});
