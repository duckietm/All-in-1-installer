import { promises as fs } from "node:fs";
import path from "node:path";
import type { RowDataPacket } from "mysql2";
import {
	digestFile,
	sourceFingerprint,
} from "@/features/catalog/releases/files";
import {
	CATALOG_RELEASE_MANIFEST_PATH,
	createReleaseManifest,
} from "@/features/catalog/releases/manifest";
import { db } from "@/lib/db";
import { getEffectMapPath } from "@/lib/services/effectmap";
import { getFigureDataPath } from "@/lib/services/figuredata";
import { getFigureMapPath } from "@/lib/services/figuremap";
import {
	getFurniAssetDirs,
	getGamedataRoot,
} from "@/lib/services/furni-asset-dirs";
import { getFurnitureDataPath } from "@/lib/services/furni-data";
import { getPublicAssetRoot } from "@/lib/services/public-asset-root";
import { siteSettings } from "@/lib/services/site-settings";
import {
	CATALOG_LANGUAGE_ROOT,
	CATALOG_SQL_ROOT,
	type CatalogFile,
	sqlValue,
} from "./catalog-git-core";

const CONFIG_FILES = [
	"FurnitureData.json",
	"EffectMap.json",
	"ExternalTexts.json",
	"FigureData.json",
	"FigureMap.json",
	"HabboAvatarActions.json",
	"ProductData.json",
];
const TABLES = ["items_base", "catalog_pages", "catalog_items"] as const;
// The catalog export must ship both bundle extensions for every asset type:
// `.hab` is what imports write now (furniture, pets, effects and figures all
// go through it), `.nitro` is what the existing asset set is made of.
const BUNDLE_FILE_RE = /\.(?:nitro|hab)$/i;
const identifier = (name: string) => `\`${name.replaceAll("`", "``")}\``;

export async function createCatalogSnapshot(
	directory: string,
): Promise<CatalogFile[]> {
	const sources = new Map<string, string>();
	const addTree = async (root: string, target: string, extensions: RegExp) => {
		async function walk(source: string, relative = "") {
			const entries = await fs
				.readdir(source, { withFileTypes: true })
				.catch((error: NodeJS.ErrnoException) => {
					if (error.code === "ENOENT") return [];
					throw error;
				});
			for (const entry of entries) {
				if (entry.isSymbolicLink())
					throw new Error("Symlink in catalog source");
				const local = path.join(source, entry.name);
				const dest = relative ? `${relative}/${entry.name}` : entry.name;
				if (entry.isDirectory()) await walk(local, dest);
				else if (entry.isFile() && extensions.test(entry.name))
					sources.set(`${target}/${dest}`, local);
			}
		}
		await walk(root);
	};
	const gamedata = await getGamedataRoot();
	const furni = await getFurniAssetDirs();
	const furnitureData = await getFurnitureDataPath();
	// Default files first; configured live locations take precedence.
	await addTree(
		path.join(getPublicAssetRoot(), "public/swf/c_images"),
		"Gamedata/c_images",
		/\.(png|gif|webp|jpe?g)$/i,
	);
	await addTree(
		path.join(getPublicAssetRoot(), "public/nitro-assets/bundled"),
		"Gamedata/bundled",
		BUNDLE_FILE_RE,
	);
	if (gamedata) {
		await addTree(
			path.join(gamedata, "bundled"),
			"Gamedata/bundled",
			BUNDLE_FILE_RE,
		);
		await addTree(
			path.join(gamedata, "icons"),
			"Gamedata/icons",
			/\.(png|gif|webp|jpe?g)$/i,
		);
		await addTree(
			path.join(gamedata, "c_images"),
			"Gamedata/c_images",
			/\.(png|gif|webp|jpe?g)$/i,
		);
	}
	await addTree(furni.nitroDir, "Gamedata/bundled/furniture", BUNDLE_FILE_RE);
	await addTree(furni.iconDir, "Gamedata/icons", /\.(png|gif|webp|jpe?g)$/i);
	for (const type of ["figure", "effect"]) {
		const configured = await siteSettings.get(`${type}_nitro_dir`, "");
		if (configured?.trim())
			await addTree(configured, `Gamedata/bundled/${type}`, BUNDLE_FILE_RE);
	}
	// Pets currently write directly to the CMS directory.
	await addTree(
		path.join(getPublicAssetRoot(), "public/nitro-assets/bundled/pet"),
		"Gamedata/bundled/pet",
		BUNDLE_FILE_RE,
	);
	const configRoot = gamedata
		? path.join(gamedata, "config")
		: path.dirname(furnitureData);
	const configuredJson: Record<string, string> = {
		FurnitureData: furnitureData,
		FigureData: await getFigureDataPath(),
		FigureMap: await getFigureMapPath(),
		EffectMap: await getEffectMapPath(),
	};
	for (const name of CONFIG_FILES) {
		const source =
			configuredJson[name.replace(/\.json$/, "")] ??
			path.join(configRoot, name);
		try {
			await fs.access(source);
			sources.set(`Gamedata/config/${name}`, source);
		} catch (error) {
			if (
				name === "FurnitureData.json" ||
				(error as NodeJS.ErrnoException).code !== "ENOENT"
			)
				throw error;
		}
	}
	for (const name of await fs.readdir(path.dirname(furnitureData))) {
		if (/^FurnitureData_[a-z]{2}\.json$/.test(name)) {
			sources.set(
				`${CATALOG_LANGUAGE_ROOT}/${name}`,
				path.join(path.dirname(furnitureData), name),
			);
		}
	}
	const files: CatalogFile[] = [];
	const fingerprints = new Map<string, string>();
	const copiedHashes = new Map<string, string>();
	const fingerprint = sourceFingerprint;
	for (const [target, source] of sources) {
		fingerprints.set(source, await fingerprint(source));
		const copy = path.join(directory, String(files.length));
		await fs.copyFile(source, copy);
		copiedHashes.set(source, (await digestFile(copy)).sha256);
		if (target.endsWith(".json")) JSON.parse(await fs.readFile(copy, "utf8"));
		files.push({ source: copy, target });
	}
	const connection = await db.$client.getConnection();
	try {
		await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
		await connection.query(
			"START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY",
		);
		const [available] = await connection.query<RowDataPacket[]>("SHOW TABLES");
		const tableNames = new Set(
			available.map((row) => String(Object.values(row)[0])),
		);
		const tables = [
			...TABLES,
			...["catalog_pages_bc", "catalog_items_bc"].filter((name) =>
				tableNames.has(name),
			),
		];
		for (const table of tables) {
			const [schemaRows] = await connection.query<RowDataPacket[]>(
				`SHOW CREATE TABLE ${identifier(table)}`,
			);
			const definition = String(schemaRows[0]["Create Table"]);
			if (!/ENGINE=InnoDB\b/i.test(definition))
				throw new Error("Catalog SQL snapshots require InnoDB tables");
			const [columns] = await connection.query<RowDataPacket[]>(
				`SHOW COLUMNS FROM ${identifier(table)}`,
			);
			const names = columns
				.filter(
					(c) => !/\b(?:VIRTUAL|STORED) GENERATED\b/.test(String(c.Extra)),
				)
				.map((c) => String(c.Field));
			const quoted = names.map(identifier).join(", ");
			const [rows] = await connection.query<RowDataPacket[]>(
				`SELECT ${quoted} FROM ${identifier(table)} ORDER BY id`,
			);
			const source = path.join(directory, `${table}.sql`);
			const output = await fs.open(source, "wx");
			try {
				await output.writeFile(
					`-- Catalog Studio snapshot. Existing rows are updated; absent rows are not deleted.\nSET NAMES utf8mb4;\n${definition.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS")};\nSTART TRANSACTION;\n`,
				);
				const update = names
					.filter((n) => n !== "id")
					.map((n) => `${identifier(n)}=VALUES(${identifier(n)})`)
					.join(", ");
				for (const row of rows) {
					await output.writeFile(
						`INSERT INTO ${identifier(table)} (${quoted}) VALUES (${names.map((n) => sqlValue(row[n])).join(", ")}) ON DUPLICATE KEY UPDATE ${update};\n`,
					);
				}
				await output.writeFile("COMMIT;\n");
			} finally {
				await output.close();
			}
			files.push({ source, target: `${CATALOG_SQL_ROOT}/${table}.sql` });
		}
		await connection.commit();
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
	for (const [source, stamp] of fingerprints) {
		if (
			(await fingerprint(source)) !== stamp ||
			(await digestFile(source)).sha256 !== copiedHashes.get(source)
		)
			throw new Error("Assets changed during export; retry required");
	}
	const entries = [];
	for (const file of files) {
		const { bytes, sha256 } = await digestFile(file.source);
		entries.push({ path: file.target, bytes, sha256 });
	}
	const manifest = createReleaseManifest(entries);
	const manifestSource = path.join(directory, "catalog-release.json");
	await fs.writeFile(manifestSource, `${JSON.stringify(manifest, null, 2)}\n`, {
		flag: "wx",
	});
	files.push({ source: manifestSource, target: CATALOG_RELEASE_MANIFEST_PATH });
	return files;
}
