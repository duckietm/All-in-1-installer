import { promises as fs } from "node:fs";
import { eq, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { apiError, apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { db, ItemsBase, queryRows } from "@/lib/db";
import { resolveBundleInDir } from "@/lib/furni/bundle-file";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import { getFurniAssetDirs } from "@/lib/services/furni-asset-dirs";
import {
	readFurniData,
	withFurniDataLock,
	writeFurniData,
} from "@/lib/services/furni-data";
import { rcon } from "@/lib/services/rcon";
import {
	computeDefaultDir,
	createNitroBundle,
	extractPartColors,
	parseNitroBundle,
} from "@/lib/services/swf-to-nitro";

function baseClassname(classname: string): string {
	return classname.includes("*") ? classname.split("*")[0] : classname;
}

// ── GET: Read bundle metadata ──────────────────────────────────────

export const GET = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request: NextRequest) => {
		const rawClassname = request.nextUrl.searchParams.get("classname");
		if (!rawClassname) return apiError("Missing classname", 400);

		const base = baseClassname(rawClassname);
		const { nitroDir } = await getFurniAssetDirs();
		const nitroPath = resolveBundleInDir(
			/*turbopackIgnore: true*/ nitroDir,
			base,
		);

		if (!nitroPath) return apiError("Bundle file not found", 404);

		try {
			const buffer = await fs.readFile(/*turbopackIgnore: true*/ nitroPath);
			const { json } = parseNitroBundle(buffer);

			// Fetch interaction flags from DB
			const items = await queryRows<{
				allow_sit: string;
				allow_lay: string;
				allow_walk: string;
			}>(sql`
        SELECT allow_sit, allow_lay, allow_walk
        FROM items_base WHERE item_name = ${rawClassname} LIMIT 1
      `);

			const dbRow = items[0];
			const flags = {
				canstandon: dbRow?.allow_walk === "1",
				cansiton: dbRow?.allow_sit === "1",
				canlayon: dbRow?.allow_lay === "1",
			};

			return apiOk({ metadata: json, flags });
		} catch (err) {
			logger.error(
				`[nitro-editor] Failed to parse bundle: ${(err as Error).message}`,
				{ err: err as Error },
			);
			return apiError("Failed to parse bundle file", 500);
		}
	},
);

// ── PUT: Save bundle metadata ──────────────────────────────────────

export const PUT = withAdmin(
	{ permission: PERMS.ASSETS_IMPORT },
	async (request: NextRequest, ctx) => {
		const body = await request.json();
		const {
			classname: rawClassname,
			metadata,
			canstandon,
			cansiton,
			canlayon,
		} = body;

		if (!rawClassname || !metadata)
			return apiError("Missing classname or metadata", 400);

		const base = baseClassname(rawClassname);
		const { nitroDir } = await getFurniAssetDirs();
		// Write back to whichever extension the file already carries, so
		// editing metadata never migrates a legacy `.nitro` to `.hab` (or the
		// reverse) as a side effect.
		const nitroPath = resolveBundleInDir(
			/*turbopackIgnore: true*/ nitroDir,
			base,
		);

		if (!nitroPath) return apiError("Bundle file not found", 404);

		const saved = await withFurniDataLock(async () => {
			const existingBuffer = await fs.readFile(nitroPath);
			const { texture, json: currentMetadata } =
				parseNitroBundle(existingBuffer);
			if (
				JSON.stringify(currentMetadata.catalogStudio) !==
				JSON.stringify(metadata.catalogStudio)
			)
				return false;
			// `texture` keeps its original encoding, so editing metadata never
			// changes the bundle's texture format.
			const newBundle = createNitroBundle(metadata, texture, base);
			await fs.writeFile(nitroPath, newBundle);
			return true;
		});
		if (!saved)
			return apiError(
				"The bundle changed. Reopen the editor before saving.",
				409,
			);

		// 3. Extract dimensions from metadata
		const dims = metadata.logic?.model?.dimensions || { x: 1, y: 1, z: 0 };
		const directions: number[] = metadata.logic?.model?.directions || [0];
		const visualizations = metadata.visualizations || [];

		// 4. Update FurnitureData.json (best-effort)
		try {
			await withFurniDataLock(async () => {
				const furniData = (await readFurniData()) as Record<
					string,
					{ furnitype: Array<Record<string, unknown>> }
				>;

				for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
					const types = furniData[section]?.furnitype;
					if (!Array.isArray(types)) continue;
					const idx = types.findIndex((e) => e.classname === rawClassname);
					if (idx !== -1) {
						types[idx].xdim = dims.x;
						types[idx].ydim = dims.y;
						types[idx].defaultdir = computeDefaultDir(directions);
						types[idx].partcolors = extractPartColors(visualizations);
						types[idx].canstandon = canstandon ?? false;
						types[idx].cansiton = cansiton ?? false;
						types[idx].canlayon = canlayon ?? false;
						break;
					}
				}

				await writeFurniData(furniData as Record<string, unknown>);
			});
		} catch (err) {
			logger.warn(
				`[nitro-editor] FurnitureData.json update failed: ${(err as Error).message}`,
			);
		}

		// 5. Update items_base (best-effort)
		try {
			await db.execute(sql`
        UPDATE items_base
        SET width = ${dims.x}, length = ${dims.y}, stack_height = ${dims.z},
            allow_sit = ${cansiton ? "1" : "0"},
            allow_lay = ${canlayon ? "1" : "0"},
            allow_walk = ${canstandon ? "1" : "0"}
        WHERE item_name = ${rawClassname}
      `);
		} catch (err) {
			logger.warn(
				`[nitro-editor] items_base update failed: ${(err as Error).message}`,
			);
		}

		// 6. RCON refresh (best-effort)
		try {
			await rcon.updateItems();
		} catch (err) {
			logger.warn(
				`[nitro-editor] RCON updateItems failed: ${(err as Error).message}`,
			);
		}

		// 7. Audit log
		try {
			const [dbItem] = await db
				.select({ id: ItemsBase.id })
				.from(ItemsBase)
				.where(eq(ItemsBase.itemName, rawClassname))
				.limit(1);
			await logAudit({
				userId: ctx.session.user.id,
				action: "furni_edit_nitro",
				target: "ItemsBase",
				targetId: dbItem?.id ?? 0,
				after: {
					classname: rawClassname,
					dimensions: dims,
					canstandon,
					cansiton,
					canlayon,
				},
			});
		} catch (err) {
			logger.warn(`[nitro-editor] Audit log failed: ${(err as Error).message}`);
		}

		return apiOk({ dimensions: dims });
	},
);
