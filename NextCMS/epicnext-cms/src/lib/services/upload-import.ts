import { promises as fs } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db, ItemsBase, queryRows } from "@/lib/db";
import { autoDetectInteraction } from "@/lib/furni/auto-interaction";
import {
	bundleWritePathInDir,
	resolveBundleInDir,
} from "@/lib/furni/bundle-file";
import { logServerError } from "@/lib/server-log";
import { getFurniAssetWriteTargets } from "@/lib/services/furni-asset-dirs";
import { appendFurniEntry, buildFurniEntry } from "@/lib/services/furni-data";
import {
	allocateCatalogItemId,
	autoPriceFurni,
	CATEGORY_PAGE,
	classifyFurni,
	ensureDirectories,
	getOrCreateCategoryPage,
	IMPORTED_PAGE_CAPTION,
	IMPORTED_PAGE_CAPTION_SAVE,
} from "@/lib/services/furni-import";
import { nitroAnimationStatesCount } from "@/lib/services/furni-real-interaction";
import {
	isLosslessWebp,
	parseNitroBundle,
	toWebpLosslessBundle,
} from "@/lib/services/swf/nitro-builder";
import { getRuntimePath, getRuntimeResolve } from "@/lib/utils/runtime-path";

export interface UploadResult {
	ok: boolean;
	itemId?: number;
	catalogItemId?: number | null;
	classname: string;
	warnings: string[];
	error?: string;
	sqlFile?: string;
}

export interface UploadParams {
	classname: string;
	name: string;
	description?: string;
	itemType: "s" | "i";
	xdim?: number;
	ydim?: number;
	canstandon?: boolean;
	cansiton?: boolean;
	canlayon?: boolean;
	interactionType?: string;
	customparams?: string;
}

const MIGRATIONS_DIR = getRuntimeResolve(
	/*turbopackIgnore: true*/ process.cwd(),
	"drizzle/migrations",
);

let itemsBaseNextId: number | null = null;
let itemsBaseIdLastUsed = 0;
let itemsBaseIdSeedChain: Promise<void> = Promise.resolve();
const ITEMS_BASE_ID_REFRESH_MS = 60_000;

function pathKey(value: string): string {
	const normalized = path.normalize(value);
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function mirrorUploadedAsset(
	sourcePath: string,
	fileName: string,
	dirs: string[],
	warnings: string[],
	copiedPaths: string[],
): Promise<void> {
	const sourceKey = pathKey(sourcePath);
	const seen = new Set<string>();
	for (const dir of dirs) {
		const targetPath = getRuntimePath(/*turbopackIgnore: true*/ dir, fileName);
		const targetKey = pathKey(targetPath);
		if (targetKey === sourceKey || seen.has(targetKey)) continue;
		seen.add(targetKey);
		try {
			await fs.copyFile(sourcePath, targetPath);
			copiedPaths.push(targetPath);
		} catch (err) {
			warnings.push(
				`asset mirror failed (${targetPath}): ${(err as Error).message}`,
			);
		}
	}
}

async function allocateItemsBaseId<T>(
	insertFn: (nextId: number) => Promise<T>,
): Promise<T> {
	const now = Date.now();
	if (
		itemsBaseNextId === null ||
		now - itemsBaseIdLastUsed > ITEMS_BASE_ID_REFRESH_MS
	) {
		let settle!: () => void;
		const prev = itemsBaseIdSeedChain;
		itemsBaseIdSeedChain = new Promise<void>((r) => {
			settle = r;
		});
		await prev.catch((error) =>
			logServerError("upload.items_base_id_chain_failed", error),
		);
		try {
			if (
				itemsBaseNextId === null ||
				Date.now() - itemsBaseIdLastUsed > ITEMS_BASE_ID_REFRESH_MS
			) {
				const idRows = await queryRows<{ next: number }>(sql`
					SELECT COALESCE(MAX(id), 0) + 1 AS next FROM items_base
				`);
				itemsBaseNextId = Number(idRows[0]?.next ?? 1);
			}
		} finally {
			settle();
		}
	}
	itemsBaseIdLastUsed = Date.now();
	const nextId = itemsBaseNextId;
	itemsBaseNextId += 1;
	return await insertFn(nextId);
}

/** Test seam: drop the cached id counter between tests. */
export function __resetUploadItemsBaseAllocatorForTests(): void {
	itemsBaseNextId = null;
	itemsBaseIdLastUsed = 0;
	itemsBaseIdSeedChain = Promise.resolve();
}

function escapeSql(val: string | number): string {
	if (typeof val === "number") return String(val);
	return `'${val.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

async function findNextMigrationNumber(): Promise<number> {
	try {
		const entries = await fs.readdir(MIGRATIONS_DIR);
		let max = 0;
		for (const entry of entries) {
			const match = entry.match(/^(\d+)_/);
			if (match) {
				const num = Number.parseInt(match[1], 10);
				if (num > max) max = num;
			}
		}
		return max + 1;
	} catch {
		return 1;
	}
}

async function writeSqlMigration(params: {
	classname: string;
	name: string;
	itemType: string;
	xdim: number;
	ydim: number;
	stackHeight: number;
	allowStack: string;
	cansiton: boolean;
	canlayon: boolean;
	canstandon: boolean;
	interactionType: string;
	customparams: string;
	price: { credits: number; points: number; pointsType: number };
	categoryKey: string;
	interactionModesCount: number;
}): Promise<string> {
	const num = await findNextMigrationNumber();
	const padded = String(num).padStart(4, "0");
	const className = params.classname.replace(/[^a-zA-Z0-9_-]/g, "_");
	const fileName = `${padded}_import_furni_${className}.sql`;
	const filePath = getRuntimePath(
		/*turbopackIgnore: true*/ MIGRATIONS_DIR,
		fileName,
	);

	const catKey = params.categoryKey;
	const captionSave = `imp_${catKey}`;
	const catInfo = CATEGORY_PAGE[catKey] || CATEGORY_PAGE.other;

	const lines: string[] = [
		`-- Migration: ${fileName}`,
		`-- Description: Import furniture "${params.classname}"`,
		`-- Generated: ${new Date().toISOString()}`,
		"",
		`-- Ensure the "Imported Furniture" parent page exists`,
		`INSERT INTO catalog_pages (caption_save, caption, page_layout, parent_id, min_rank, order_num, icon_image, enabled, visible, includes, page_headline, page_teaser, page_special, page_text1, page_text2, page_text_details, page_text_teaser)`,
		`SELECT ${escapeSql(IMPORTED_PAGE_CAPTION_SAVE)}, ${escapeSql(IMPORTED_PAGE_CAPTION)}, 'default_3x3', -1, '1', 9999, 263, '1', '1', '', '', '', '', '', '', '', ''`,
		`WHERE NOT EXISTS (SELECT 1 FROM catalog_pages WHERE caption_save = ${escapeSql(IMPORTED_PAGE_CAPTION_SAVE)});`,
		"",
		`-- Ensure the category sub-page exists (${catKey})`,
		`INSERT INTO catalog_pages (caption_save, caption, page_layout, parent_id, min_rank, order_num, icon_image, enabled, visible, includes, page_headline, page_teaser, page_special, page_text1, page_text2, page_text_details, page_text_teaser)`,
		`SELECT ${escapeSql(captionSave)}, ${escapeSql(catInfo.label)}, 'default_3x3', p.id, '1', ${catInfo.order}, ${catInfo.icon}, '1', '1', '', '', '', '', '', '', '', ''`,
		`FROM catalog_pages p`,
		`WHERE p.caption_save = ${escapeSql(IMPORTED_PAGE_CAPTION_SAVE)}`,
		`  AND NOT EXISTS (SELECT 1 FROM catalog_pages c WHERE c.caption_save = ${escapeSql(captionSave)} AND c.parent_id = p.id);`,
		"",
		`SET @next_id = (SELECT COALESCE(MAX(id), 0) + 1 FROM items_base);`,
		"",
		`INSERT INTO items_base`,
		`  (id, sprite_id, public_name, item_name, type, width, length, stack_height,`,
		`   allow_stack, allow_sit, allow_lay, allow_walk, interaction_type, interaction_modes_count, customparams)`,
		`VALUES`,
		`  (@next_id, @next_id, ${escapeSql(params.name)}, ${escapeSql(params.classname)},`,
		`   ${escapeSql(params.itemType)}, ${params.xdim}, ${params.ydim}, ${params.stackHeight},`,
		`   ${params.allowStack}, ${params.cansiton ? "1" : "0"}, ${params.canlayon ? "1" : "0"}, ${params.canstandon ? "1" : "0"},`,
		`   ${escapeSql(params.interactionType)}, ${params.interactionModesCount}, ${escapeSql(params.customparams)});`,
		"",
		`INSERT INTO catalog_items`,
		`  (id, page_id, item_ids, catalog_name, cost_credits, cost_points, points_type, amount, order_number, offer_id, extradata)`,
		`SELECT (SELECT COALESCE(MAX(id), 0) + 1 FROM catalog_items), p.id, @next_id, ${escapeSql(params.classname)},`,
		`  ${params.price.credits}, ${params.price.points}, ${params.price.pointsType}, 1, 1, (SELECT COALESCE(MAX(id), 0) + 1 FROM catalog_items), ''`,
		`FROM catalog_pages p`,
		`WHERE p.caption_save = ${escapeSql(captionSave)};`,
		"",
	];

	const sql = lines.join("\n");
	await fs.mkdir(MIGRATIONS_DIR, { recursive: true });
	await fs.writeFile(filePath, sql, "utf-8");
	return fileName;
}

export async function uploadSingleFurni(params: {
	classname: string;
	name: string;
	description?: string;
	itemType: "s" | "i";
	xdim?: number;
	ydim?: number;
	canstandon?: boolean;
	cansiton?: boolean;
	canlayon?: boolean;
	interactionType?: string;
	customparams?: string;
	nitroBuffer: Buffer;
	iconBuffer?: Buffer | null;
	generateSql?: boolean;
}): Promise<UploadResult> {
	const {
		classname,
		name,
		description = "",
		itemType,
		xdim: userXdim,
		ydim: userYdim,
		canstandon = false,
		cansiton = false,
		canlayon = false,
		interactionType: userInteractionType = "default",
		customparams = "",
		nitroBuffer,
		iconBuffer,
		generateSql = false,
	} = params;
	const warnings: string[] = [];

	if (!/^[\w\-.*]+$/.test(classname)) {
		return { ok: false, classname, warnings, error: "invalid classname" };
	}

	const existing = await db
		.select({ id: ItemsBase.id })
		.from(ItemsBase)
		.where(eq(ItemsBase.itemName, classname))
		.limit(1);
	if (existing.length > 0) {
		return {
			ok: false,
			classname,
			warnings,
			error: "Item already exists in database",
		};
	}

	let nitroMeta: Record<string, unknown> | null = null;
	// Studio imports always land as WebP Lossless, whatever the uploaded
	// bundle carried, so a hotel-supplied PNG and an SWF import end up
	// identical on disk. Re-encoding also repairs a `meta.image` pointer that
	// disagrees with the texture member, which would otherwise store fine and
	// then render nothing. The member keeps its own base name, so `chair*2`
	// colour variants that share the `chair` library are not renamed.
	let storedNitro = nitroBuffer;
	try {
		const parsed = parseNitroBundle(nitroBuffer);
		nitroMeta = parsed.json;
		storedNitro = await toWebpLosslessBundle(nitroBuffer);
		if (!isLosslessWebp(parsed.texture))
			warnings.push("texture converted to WebP Lossless");
	} catch {
		return { ok: false, classname, warnings, error: "invalid bundle" };
	}

	await ensureDirectories();
	const assetTargets = await getFurniAssetWriteTargets();
	const { iconDir, nitroDir } = assetTargets;

	// Bundles are stored as `<classname>.hab` — the extension this deployment's
	// client requests. The uploaded file may arrive named `.hab` or `.nitro`;
	// parsing above is format-based, so both are the same bundle. A legacy
	// `.nitro` left on disk still counts as a collision, otherwise the item
	// would end up served by whichever the client happens to ask for first.
	const existingBundle = resolveBundleInDir(
		/*turbopackIgnore: true*/ nitroDir,
		classname,
	);
	if (existingBundle) {
		return {
			ok: false,
			classname,
			warnings,
			error: `${path.basename(existingBundle)} already exists on disk`,
		};
	}
	const nitroFileName = path.basename(bundleWritePathInDir("", classname));
	const nitroPath = bundleWritePathInDir(
		/*turbopackIgnore: true*/ nitroDir,
		classname,
	);
	await fs.writeFile(nitroPath, storedNitro);

	let iconFileName: string | null = null;
	let iconPath: string | null = null;
	if (iconBuffer && iconBuffer.length > 0) {
		iconFileName = `${classname}_icon.png`;
		iconPath = getRuntimePath(/*turbopackIgnore: true*/ iconDir, iconFileName);
		await fs.writeFile(iconPath, iconBuffer);
	}

	const mirroredPaths: string[] = [];
	await mirrorUploadedAsset(
		nitroPath,
		nitroFileName,
		assetTargets.mirrorDirs.map((target) => target.nitroDir),
		warnings,
		mirroredPaths,
	);
	if (iconPath && iconFileName) {
		await mirrorUploadedAsset(
			iconPath,
			iconFileName,
			assetTargets.mirrorDirs.map((target) => target.iconDir),
			warnings,
			mirroredPaths,
		);
	}

	const xdim = userXdim ?? Number(nitroMeta?.xdim ?? 1);
	const ydim = userYdim ?? Number(nitroMeta?.ydim ?? 1);

	const stackHeight = canlayon || cansiton ? 1.0 : canstandon ? 1.0 : 0.0;
	const allowStack = stackHeight > 0 ? "1" : "0";

	const price = autoPriceFurni(classname);

	// Auto-detect interaction modes count. Real flags + .nitro animation
	// states win over keyword guessing — no false positives.
	const autoInteraction = autoDetectInteraction(classname, name, {
		cansiton,
		canlayon,
		canstandon,
		// Flags come from explicit user input → authoritative over keywords.
		hasActionData: true,
		logicType: (nitroMeta?.logicType as string) || undefined,
		animationStates: nitroAnimationStatesCount(nitroMeta),
	});
	const interactionModesCount = autoInteraction.interactionModesCount;

	let newId: number;
	try {
		newId = await allocateItemsBaseId(async (nextId) => {
			await db.execute(sql`
        INSERT INTO items_base
          (id, sprite_id, public_name, item_name, type, width, length, stack_height,
           allow_stack, allow_sit, allow_lay, allow_walk, interaction_type, interaction_modes_count, customparams)
        VALUES
          (${nextId}, ${nextId}, ${name}, ${classname}, ${itemType}, ${xdim}, ${ydim}, ${stackHeight},
           ${allowStack}, ${cansiton ? "1" : "0"}, ${canlayon ? "1" : "0"}, ${canstandon ? "1" : "0"}, ${userInteractionType}, ${interactionModesCount}, ${customparams})`);
			return nextId;
		});
	} catch (err) {
		await fs
			.unlink(nitroPath)
			.catch((error) =>
				logServerError("upload.cleanup_nitro_failed", error, { classname }),
			);
		if (iconPath)
			await fs
				.unlink(iconPath)
				.catch((error) =>
					logServerError("upload.cleanup_icon_failed", error, { classname }),
				);
		await Promise.all(
			mirroredPaths.map((file) =>
				fs
					.unlink(file)
					.catch((error) =>
						logServerError("upload.cleanup_mirror_failed", error, { file }),
					),
			),
		);
		return {
			ok: false,
			classname,
			warnings,
			error: `items_base insert failed: ${(err as Error).message}`,
		};
	}

	try {
		const furniEntry = buildFurniEntry({
			id: newId,
			classname,
			revision: 0,
			category: "unknown",
			name,
			description,
			spriteId: newId,
			dims: { x: xdim, y: ydim, z: stackHeight },
			metadata: null,
		});
		await appendFurniEntry(furniEntry, itemType);
	} catch (err) {
		warnings.push(`FurnitureData append failed: ${(err as Error).message}`);
	}

	let catalogItemId: number | null = null;
	try {
		// Skip when the item already has a catalog row — re-uploads must never
		// create a second row for the same item_ids.
		const existingCatalog = await queryRows<{ id: number }>(sql`
      SELECT id FROM catalog_items WHERE item_ids = ${String(newId)} LIMIT 1
    `);
		if (existingCatalog.length > 0) {
			catalogItemId = existingCatalog[0].id;
			warnings.push(
				`catalog entry already exists (#${catalogItemId}) — skipped duplicate`,
			);
		} else {
			const pageId = await getOrCreateCategoryPage(classname, itemType);
			catalogItemId = await allocateCatalogItemId(async (nextCatalogId) => {
				await db.execute(sql`
        INSERT INTO catalog_items (id, page_id, item_ids, catalog_name, cost_credits, cost_points, points_type, amount, order_number, offer_id, extradata)
        VALUES (${nextCatalogId}, ${String(pageId)}, ${String(newId)}, ${classname}, ${price.credits}, ${price.points}, ${price.pointsType}, 1, 1, ${nextCatalogId}, '')`);
				return nextCatalogId;
			});
		}
	} catch (err) {
		warnings.push(`catalog entry failed: ${(err as Error).message}`);
	}

	let sqlFile: string | undefined;
	if (generateSql) {
		try {
			sqlFile = await writeSqlMigration({
				classname,
				name,
				itemType,
				xdim,
				ydim,
				stackHeight,
				allowStack,
				cansiton,
				canlayon,
				canstandon,
				interactionType: userInteractionType,
				customparams,
				price,
				categoryKey: classifyFurni(classname, itemType),
				interactionModesCount,
			});
			warnings.push(`SQL migration written: ${sqlFile}`);
		} catch (err) {
			warnings.push(`Failed to write SQL migration: ${(err as Error).message}`);
		}
	}

	return {
		ok: true,
		itemId: newId,
		catalogItemId,
		classname,
		warnings,
		sqlFile,
	};
}
