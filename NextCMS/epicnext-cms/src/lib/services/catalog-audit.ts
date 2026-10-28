import { readdir } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { queryRows } from "@/lib/db";
import { fetchSourceFurnidata } from "@/lib/services/clone-import";
import { listSources } from "@/lib/services/clone-sources";
import {
	getFurniAssetDirs,
	getGamedataRoot,
} from "@/lib/services/furni-asset-dirs";
import { getRuntimePath } from "@/lib/utils/runtime-path";
import {
	applyCatalogSql,
	generateCatalogSql,
	type MissingCatalogEntry,
	repairDuplicateClassnames,
	repairFurniData,
	repairOrphanedCatalog,
} from "./catalog-repair";
import { readFurniData } from "./furni-data";
import { ensureDirectories } from "./furni-import";
import {
	assetNameCandidates,
	type CatalogItemKind,
	classifyCatalogItem,
	isBadgeType,
	NO_ASSET_KINDS,
	NO_CATALOG_KINDS,
} from "./item-kind";
import { repairMissingIcons } from "./repair-icons";
import { repairMissingNitros } from "./repair-nitros";

export interface AuditEvent {
	type:
		| "progress"
		| "items_loaded"
		| "catalog_loaded"
		| "checking"
		| "repair_complete"
		| "sql_ready"
		| "sql_applied"
		| "furnidata_repair_complete"
		| "structure_repair_complete"
		| "batch_complete"
		| "error";
	message?: string;
	current?: number;
	total?: number;
	section?: string;
	issues?: AuditIssue[];
	missingFromSources?: MissingFromSource[];
	unrepairable?: UnrepairableItem[];
	summary?: AuditSummary;
	furniDataIdConflicts?: Array<{
		classname: string;
		itemId: number;
		conflictingId: number;
		existingClassname: string;
	}>;
	repair?: RepairStats;
	repairNitro?: RepairStats;
	sql?: string;
	sqlCount?: number;
	applied?: number;
	sqlFailed?: number;
	furniData?: {
		added: number;
		removedDuplicates: number;
		removedIdConflicts: number;
	};
	structure?: {
		orphanedRemoved: number;
		orphanedCleaned: number;
		duplicatesMerged: number;
		duplicateRowsRemoved: number;
		remappedReferences: number;
	};
}

export interface RepairStats {
	succeeded: number;
	failed: number;
	skipped: number;
	stillMissing: number;
}

export interface AuditIssue {
	type: string;
	severity: "error" | "warning" | "info";
	classname?: string;
	itemId?: number;
	catalogId?: number;
	message: string;
	sourceName?: string;
}

export interface MissingFromSource {
	sourceName: string;
	sourceId: string;
	classname: string;
	itemName: string;
}

export interface UnrepairableItem {
	classname: string;
	itemId: number;
	missing: Array<"nitro" | "icon">;
}

export interface AuditSummary {
	totalItemsBase: number;
	totalCatalogItems: number;
	missingCatalog: number;
	orphanedCatalog: number;
	missingNitro: number;
	missingIcon: number;
	duplicates: number;
	missingFromSourcesTotal: number;
	unrepairableCount: number;
	iconsRepaired: number;
	iconsStillMissing: number;
	nitrosRepaired: number;
	nitrosStillMissing: number;
	catalogSqlCount: number;
	catalogSqlApplied: number;
	furniDataAdded: number;
	furniDataDuplicatesRemoved: number;
	orphanedRemoved: number;
	orphanedCleaned: number;
	duplicatesMerged: number;
	duplicateRowsRemoved: number;
	remappedReferences: number;
	furniDataIdConflicts: number;
}

export interface CatalogAuditOptions {
	repair?: boolean;
	repairNitros?: boolean;
	sql?: boolean;
	applySql?: boolean;
	organizeSql?: boolean;
	repairFurniData?: boolean;
	repairStructure?: boolean;
	checkFurniDataIds?: boolean;
	/**
	 * Restrict the clone-source comparison to these sources (by id or name).
	 * Empty/omitted keeps every enabled source, which is the default.
	 */
	sourceIds?: string[];
}

export async function runCatalogAudit(
	onEvent?: (evt: AuditEvent) => void,
	options?: CatalogAuditOptions,
): Promise<void> {
	let issues: AuditIssue[] = [];
	const missingFromSources: MissingFromSource[] = [];
	// Items whose missing assets could not be restored from any source even
	// after a repair attempt — legacy / broken furniture. Keyed by classname so
	// an item missing both assets is listed once.
	const unrepairable = new Map<
		string,
		{ itemId: number; missing: Set<"nitro" | "icon"> }
	>();

	try {
		await ensureDirectories();
	} catch (err) {
		onEvent?.({
			type: "error",
			message: `ensureDirectories failed: ${(err as Error).message}`,
		});
		return;
	}

	let iconDir: string;
	let nitroDir: string;
	try {
		const dirs = await getFurniAssetDirs();
		iconDir = dirs.iconDir;
		nitroDir = dirs.nitroDir;
	} catch (err) {
		onEvent?.({
			type: "error",
			message: `getFurniAssetDirs failed: ${(err as Error).message}`,
		});
		return;
	}

	const [iconFiles, nitroFiles, badgeGifFiles] = await Promise.all([
		readdir(iconDir).catch(() => [] as string[]),
		readdir(nitroDir).catch(() => [] as string[]),
		(async () => {
			try {
				const gamedataRoot = await getGamedataRoot();
				if (!gamedataRoot) return [] as string[];
				return await readdir(getRuntimePath(gamedataRoot, "album1584")).catch(
					() => [] as string[],
				);
			} catch {
				return [] as string[];
			}
		})(),
	]);
	let iconSet = new Set(iconFiles);
	let nitroSet = new Set(nitroFiles);
	// Badge detection: `items_base.type = 'b'` is authoritative. The album1584
	// `.gif` listing is kept as a fallback for hotels that store badges with a
	// non-standard type.
	const badgeGifSet = new Set(
		badgeGifFiles.filter((f) => f.endsWith(".gif")).map((f) => f.slice(0, -4)),
	);

	onEvent?.({ type: "progress", message: "Loading items_base…" });

	let items: Array<{
		id: number;
		item_name: string;
		public_name: string;
		type: string;
		interaction_type: string;
	}>;
	try {
		items = await queryRows<(typeof items)[number]>(sql`
			SELECT id, item_name, public_name, type, interaction_type
			FROM items_base ORDER BY id
		`);
	} catch (err) {
		onEvent?.({
			type: "error",
			message: `items_base query failed: ${(err as Error).message}`,
		});
		return;
	}

	// item_name → catalog item kind (badge / pet / effect / bot / sticky / furni).
	const kindByName = new Map<string, CatalogItemKind>();
	for (const item of items) {
		let kind = classifyCatalogItem(item);
		if (
			kind === "furni" &&
			(isBadgeType(item.type) || badgeGifSet.has(item.item_name))
		) {
			kind = "badge";
		}
		kindByName.set(item.item_name, kind);
	}
	const kindOf = (name: string): CatalogItemKind =>
		kindByName.get(name) ?? "furni";

	onEvent?.({ type: "items_loaded", total: items.length });

	onEvent?.({ type: "progress", message: "Loading catalog_items…" });

	let catalogItems: Array<{
		id: number;
		item_ids: string;
		catalog_name: string;
	}>;
	try {
		catalogItems = await queryRows<(typeof catalogItems)[number]>(sql`
			SELECT id, item_ids, catalog_name FROM catalog_items ORDER BY id
		`);
	} catch (err) {
		onEvent?.({
			type: "error",
			message: `catalog_items query failed: ${(err as Error).message}`,
		});
		return;
	}

	onEvent?.({ type: "catalog_loaded", total: catalogItems.length });

	const itemIdsWithCatalog = new Set<number>();
	for (const ci of catalogItems) {
		const ids = ci.item_ids.split(";").map(Number).filter(Boolean);
		for (const id of ids) {
			itemIdsWithCatalog.add(id);
		}
	}

	const itemById = new Map<number, (typeof items)[0]>();
	const itemByName = new Map<string, (typeof items)[0]>();
	const classnameCount = new Map<string, number>();
	for (const item of items) {
		itemById.set(item.id, item);
		itemByName.set(item.item_name, item);
		classnameCount.set(
			item.item_name,
			(classnameCount.get(item.item_name) ?? 0) + 1,
		);
	}

	onEvent?.({
		type: "checking",
		section: "missing_catalog",
		total: items.length,
	});

	const missingCatalogEntries: MissingCatalogEntry[] = [];
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		const kind = kindOf(item.item_name);
		// Badges and system items (effects, bots, sticky notes) are awarded or
		// system-managed, not catalog-purchasable — don't flag or auto-add them.
		if (NO_CATALOG_KINDS.has(kind)) continue;
		if (!itemIdsWithCatalog.has(item.id)) {
			issues.push({
				type: "missing_catalog",
				severity: "warning",
				classname: item.item_name,
				itemId: item.id,
				message: `"${item.item_name}" (ID ${item.id}) has no catalog_items entry — not purchasable`,
			});
			const hasNitro = assetNameCandidates(
				item.item_name,
				item.public_name,
			).nitro.some((n) => nitroSet.has(n));
			// Pets ship their assets through the pet pipeline, not as furni
			// .nitro bundles, so they can get a catalog entry regardless.
			if (kind === "pet" || hasNitro) {
				missingCatalogEntries.push({
					classname: item.item_name,
					itemId: item.id,
					itemType: item.type,
					publicName: item.public_name,
				});
			}
		}
		if (i % 100 === 0) {
			onEvent?.({
				type: "checking",
				section: "missing_catalog",
				current: i,
				total: items.length,
			});
		}
	}

	onEvent?.({ type: "checking", section: "duplicates" });

	for (const [name, count] of classnameCount) {
		if (count > 1) {
			issues.push({
				type: "duplicate_classname",
				severity: "error",
				classname: name,
				message: `"${name}" appears ${count} times in items_base`,
			});
		}
	}

	onEvent?.({
		type: "checking",
		section: "orphaned_catalog",
		total: catalogItems.length,
	});

	for (let i = 0; i < catalogItems.length; i++) {
		const ci = catalogItems[i];
		const ids = ci.item_ids.split(";").map(Number).filter(Boolean);
		for (const id of ids) {
			if (!itemById.has(id)) {
				issues.push({
					type: "orphaned_catalog",
					severity: "error",
					catalogId: ci.id,
					message: `catalog_items ID ${ci.id} ("${ci.catalog_name}") references items_base ID ${id} which does not exist`,
				});
			}
		}
		if (i % 200 === 0) {
			onEvent?.({
				type: "checking",
				section: "orphaned_catalog",
				current: i,
				total: catalogItems.length,
			});
		}
	}

	onEvent?.({
		type: "checking",
		section: "missing_nitro",
		total: items.length,
	});

	const missingNitroClassnames: string[] = [];
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		// Badges, pets, effects, bots and sticky notes never ship a furni
		// .nitro bundle — skip the asset check for them.
		if (NO_ASSET_KINDS.has(kindOf(item.item_name))) continue;
		const hasNitro = assetNameCandidates(
			item.item_name,
			item.public_name,
		).nitro.some((n) => nitroSet.has(n));
		if (!hasNitro) {
			missingNitroClassnames.push(item.item_name);
			issues.push({
				type: "missing_nitro",
				severity: "error",
				classname: item.item_name,
				itemId: item.id,
				message: `"${item.item_name}" (ID ${item.id}) has no .nitro file`,
			});
		}
		if (i % 100 === 0) {
			onEvent?.({
				type: "checking",
				section: "missing_nitro",
				current: i,
				total: items.length,
			});
		}
	}

	onEvent?.({ type: "checking", section: "missing_icon", total: items.length });

	const missingIconClassnames: string[] = [];
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		// Badges use album1584 .gif icons; pets, effects, bots and sticky notes
		// never ship a furni icon file — skip the asset check for them.
		if (NO_ASSET_KINDS.has(kindOf(item.item_name))) continue;
		const hasIcon = assetNameCandidates(
			item.item_name,
			item.public_name,
		).icon.some((n) => iconSet.has(n));
		if (!hasIcon) {
			missingIconClassnames.push(item.item_name);
			issues.push({
				type: "missing_icon",
				severity: "warning",
				classname: item.item_name,
				itemId: item.id,
				message: `"${item.item_name}" (ID ${item.id}) has no icon file`,
			});
		}
		if (i % 100 === 0) {
			onEvent?.({
				type: "checking",
				section: "missing_icon",
				current: i,
				total: items.length,
			});
		}
	}

	let repairStats: RepairStats | null = null;
	if (options?.repair && missingIconClassnames.length > 0) {
		onEvent?.({
			type: "progress",
			message: `Repairing ${missingIconClassnames.length} missing icons…`,
		});

		try {
			const result = await repairMissingIcons((evt) => {
				if (evt.type === "progress") {
					onEvent?.({
						type: "checking",
						section: "repair_icons",
						current: evt.index,
						total: evt.total,
						message:
							evt.status === "done"
								? `Repaired ${evt.classname}`
								: evt.status === "failed"
									? `Failed: ${evt.classname}`
									: undefined,
					});
				} else if (evt.type === "error") {
					onEvent?.({ type: "error", message: evt.message });
				}
			});

			// Re-read directories so the set reflects files written
			// by the repair pass.
			const [repairedIconFiles, repairedNitroFiles] = await Promise.all([
				readdir(iconDir).catch(() => [] as string[]),
				readdir(nitroDir).catch(() => [] as string[]),
			]);
			iconSet = new Set(repairedIconFiles);
			nitroSet = new Set(repairedNitroFiles);

			// Re-check which of the previously-missing icons are still missing
			// and drop the ones the repair fixed from the issue list. The ones
			// left over cannot be restored from any source → legacy/broken.
			const stillMissing: string[] = [];
			for (const classname of missingIconClassnames) {
				const item = itemByName.get(classname);
				const hasIcon = assetNameCandidates(
					classname,
					item?.public_name,
				).icon.some((n) => iconSet.has(n));
				if (!hasIcon) {
					stillMissing.push(classname);
				}
			}
			issues = issues.filter((i) => i.type !== "missing_icon");
			for (const classname of stillMissing) {
				const entry = unrepairable.get(classname) ?? {
					itemId: itemByName.get(classname)?.id ?? 0,
					missing: new Set(),
				};
				entry.missing.add("icon");
				unrepairable.set(classname, entry);
			}

			repairStats = {
				succeeded: result.succeeded,
				failed: result.failed,
				skipped: result.skipped,
				stillMissing: stillMissing.length,
			};
			onEvent?.({ type: "repair_complete", repair: repairStats });
		} catch (err) {
			onEvent?.({
				type: "error",
				message: `Icon repair failed: ${(err as Error).message}`,
			});
		}
	}

	let nitroRepairStats: RepairStats | null = null;
	if (options?.repairNitros && missingNitroClassnames.length > 0) {
		onEvent?.({
			type: "progress",
			message: `Repairing ${missingNitroClassnames.length} missing .nitro files…`,
		});

		try {
			const result = await repairMissingNitros((evt) => {
				if (evt.type === "progress") {
					onEvent?.({
						type: "checking",
						section: "repair_nitros",
						current: evt.index,
						total: evt.total,
						message:
							evt.status === "done"
								? `Repaired ${evt.classname}`
								: evt.status === "failed"
									? `Failed: ${evt.classname}`
									: undefined,
					});
				} else if (evt.type === "error") {
					onEvent?.({ type: "error", message: evt.message });
				}
			});

			// Re-read directories so the set reflects files written
			// by the repair pass.
			const [repairedIconFiles2, repairedNitroFiles2] = await Promise.all([
				readdir(iconDir).catch(() => [] as string[]),
				readdir(nitroDir).catch(() => [] as string[]),
			]);
			iconSet = new Set(repairedIconFiles2);
			nitroSet = new Set(repairedNitroFiles2);

			// Re-check which of the previously-missing nitros are still missing
			// and drop the ones the repair fixed from the issue list. The ones
			// left over cannot be restored from any source → legacy/broken.
			const stillMissing: string[] = [];
			for (const classname of missingNitroClassnames) {
				const item = itemByName.get(classname);
				const hasNitro = assetNameCandidates(
					classname,
					item?.public_name,
				).nitro.some((n) => nitroSet.has(n));
				if (!hasNitro) {
					stillMissing.push(classname);
				}
			}
			issues = issues.filter((i) => i.type !== "missing_nitro");
			for (const classname of stillMissing) {
				const entry = unrepairable.get(classname) ?? {
					itemId: itemByName.get(classname)?.id ?? 0,
					missing: new Set(),
				};
				entry.missing.add("nitro");
				unrepairable.set(classname, entry);
			}

			nitroRepairStats = {
				succeeded: result.succeeded,
				failed: result.failed,
				skipped: result.skipped,
				stillMissing: stillMissing.length,
			};
			onEvent?.({
				type: "repair_complete",
				repairNitro: nitroRepairStats,
			});
		} catch (err) {
			onEvent?.({
				type: "error",
				message: `.nitro repair failed: ${(err as Error).message}`,
			});
		}
	}

	// ── Structural repair: orphaned catalog refs + duplicate classnames ──
	let orphanedRemoved = 0;
	let orphanedCleaned = 0;
	let duplicatesMerged = 0;
	let duplicateRowsRemoved = 0;
	let remappedReferences = 0;
	if (options?.repairStructure) {
		onEvent?.({
			type: "progress",
			message: "Repairing structural issues (orphaned refs + duplicates)…",
		});
		try {
			const orphanResult = await repairOrphanedCatalog();
			orphanedRemoved = orphanResult.removed;
			orphanedCleaned = orphanResult.cleaned;

			// Re-derive orphaned_catalog issues from the fixed data.
			const afterCatalog = await queryRows<{
				id: number;
				item_ids: string;
				catalog_name: string;
			}>(sql`
				SELECT id, item_ids, catalog_name FROM catalog_items ORDER BY id
			`);
			const orphanedCatalogIds = new Set<number>();
			for (const ci of afterCatalog) {
				const ids = ci.item_ids.split(";").map(Number).filter(Boolean);
				for (const id of ids) {
					if (!itemById.has(id)) orphanedCatalogIds.add(ci.id);
				}
			}
			issues = issues.filter(
				(i) =>
					i.type !== "orphaned_catalog" ||
					orphanedCatalogIds.has(i.catalogId ?? -1),
			);

			const duplicateResult = await repairDuplicateClassnames();
			duplicatesMerged = duplicateResult.merged;
			duplicateRowsRemoved = duplicateResult.rowsRemoved;
			remappedReferences = duplicateResult.remapped;

			// Re-derive duplicate_classname issues from the fixed data.
			const afterItems = await queryRows<{ item_name: string }>(sql`
				SELECT item_name FROM items_base
			`);
			const afterCount = new Map<string, number>();
			for (const row of afterItems) {
				afterCount.set(row.item_name, (afterCount.get(row.item_name) ?? 0) + 1);
			}
			const dupNames = new Set(
				[...afterCount].filter(([, count]) => count > 1).map(([name]) => name),
			);
			issues = issues.filter(
				(i) =>
					i.type !== "duplicate_classname" || dupNames.has(i.classname ?? ""),
			);

			onEvent?.({
				type: "structure_repair_complete",
				structure: {
					orphanedRemoved,
					orphanedCleaned,
					duplicatesMerged,
					duplicateRowsRemoved,
					remappedReferences,
				},
			});

			// Structural repair can DELETE items_base rows (duplicate classname
			// merge) and rewrite catalog_items.item_ids, so the missing-catalog
			// list computed from the pre-repair snapshot is stale: entries may
			// reference ids that no longer exist. Re-derive it from the repaired
			// state, otherwise the generated catalog SQL would insert orphaned
			// catalog_items rows (item_ids pointing at deleted sprite ids).
			if (duplicateRowsRemoved > 0 || orphanedRemoved > 0) {
				const postItems = await queryRows<(typeof items)[number]>(sql`
					SELECT id, item_name, public_name, type, interaction_type
					FROM items_base ORDER BY id
				`);
				items = postItems;

				const postCatalog = await queryRows<{
					id: number;
					item_ids: string;
					catalog_name: string;
				}>(sql`
					SELECT id, item_ids, catalog_name FROM catalog_items ORDER BY id
				`);
				const postCatalogIds = new Set<number>();
				for (const ci of postCatalog) {
					const ids = ci.item_ids.split(";").map(Number).filter(Boolean);
					for (const id of ids) postCatalogIds.add(id);
				}

				missingCatalogEntries.length = 0;
				for (const item of items) {
					let kind = classifyCatalogItem(item);
					if (
						kind === "furni" &&
						(isBadgeType(item.type) || badgeGifSet.has(item.item_name))
					) {
						kind = "badge";
					}
					if (NO_CATALOG_KINDS.has(kind)) continue;
					if (postCatalogIds.has(item.id)) continue;
					const hasNitro = assetNameCandidates(
						item.item_name,
						item.public_name,
					).nitro.some((n) => nitroSet.has(n));
					if (kind === "pet" || hasNitro) {
						missingCatalogEntries.push({
							classname: item.item_name,
							itemId: item.id,
							itemType: item.type,
							publicName: item.public_name,
						});
					}
				}
			}
		} catch (err) {
			onEvent?.({
				type: "error",
				message: `Structural repair failed: ${(err as Error).message}`,
			});
		}
	}

	// ── Catalog SQL generation / apply ────────────────────────────────
	let catalogSqlCount = 0;
	let catalogSqlApplied = 0;
	if ((options?.sql || options?.applySql) && missingCatalogEntries.length > 0) {
		onEvent?.({
			type: "progress",
			message: `Generating catalog SQL for ${missingCatalogEntries.length} items…`,
		});
		try {
			const result = await generateCatalogSql(missingCatalogEntries, {
				organizeSql: options?.organizeSql,
			});
			catalogSqlCount = result.count;
			onEvent?.({
				type: "sql_ready",
				sql: result.sql,
				sqlCount: result.count,
			});
			if (options.applySql) {
				const applyResult = await applyCatalogSql(result.statements);
				catalogSqlApplied = applyResult.applied;
				onEvent?.({
					type: "sql_applied",
					applied: applyResult.applied,
					sqlFailed: applyResult.failed,
				});
			}
		} catch (err) {
			onEvent?.({
				type: "error",
				message: `Catalog SQL failed: ${(err as Error).message}`,
			});
		}
	}

	// ── FurnitureData.json repair (add missing + dedupe) ──────────────
	let furniDataAdded = 0;
	let furniDataDuplicatesRemoved = 0;
	if (options?.repairFurniData) {
		onEvent?.({ type: "progress", message: "Repairing FurnitureData.json…" });
		try {
			const result = await repairFurniData(items);
			furniDataAdded = result.added;
			furniDataDuplicatesRemoved = result.removedDuplicates;
			onEvent?.({
				type: "furnidata_repair_complete",
				furniData: {
					added: result.added,
					removedDuplicates: result.removedDuplicates,
					removedIdConflicts: result.removedIdConflicts,
				},
			});
		} catch (err) {
			onEvent?.({
				type: "error",
				message: `FurnitureData repair failed: ${(err as Error).message}`,
			});
		}
	}

	// ── FurnitureData.json id conflict check ──────────────
	let furniDataIdConflicts: {
		classname: string;
		itemId: number;
		conflictingId: number;
		existingClassname: string;
	}[] = [];
	if (options?.checkFurniDataIds) {
		onEvent?.({
			type: "progress",
			message: "Checking FurnitureData.json for spriteId conflicts…",
		});
		try {
			const furniData = (await readFurniData()) as Record<
				string,
				{ furnitype: Array<Record<string, unknown>> }
			>;
			// Build map of id → classname from both sections
			const idToClassname = new Map<number, string>();
			for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
				for (const e of furniData[section]?.furnitype ?? []) {
					const id = Number(e?.id);
					const classname = typeof e?.classname === "string" ? e.classname : "";
					if (!Number.isFinite(id) || id <= 0 || !classname) continue;
					const existing = idToClassname.get(id);
					if (existing && existing !== classname) {
						// Conflict: same id used by different classname
						furniDataIdConflicts.push({
							classname,
							itemId: id,
							conflictingId: id,
							existingClassname: existing,
						});
					} else if (!existing) {
						idToClassname.set(id, classname);
					}
				}
			}
			// Remove duplicates (same classname + id pair counted once)
			const seen = new Set<string>();
			furniDataIdConflicts = furniDataIdConflicts.filter((c) => {
				const key = `${c.classname}:${c.conflictingId}`;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
		} catch (err) {
			onEvent?.({
				type: "error",
				message: `FurnitureData id check failed: ${(err as Error).message}`,
			});
		}
	}

	onEvent?.({ type: "progress", message: "Comparing with clone sources…" });

	const allSources = await listSources();
	// An explicit selection compares against just those sites; leaving it empty
	// keeps the historical "compare against everything enabled" behaviour.
	const wantedIds = new Set(options?.sourceIds ?? []);
	const sources = wantedIds.size
		? allSources.filter((s) => wantedIds.has(s.id) || wantedIds.has(s.name))
		: allSources;
	const sourceResults = await Promise.all(
		sources
			.filter((s) => s.furnidataUrl)
			.map(async (source) => {
				try {
					const entries = await fetchSourceFurnidata(source.furnidataUrl);
					return {
						source,
						entries,
						error: null,
					} as const;
				} catch {
					return {
						source,
						entries: [] as Array<{ classname: string; name: string }>,
						error: true,
					} as const;
				}
			}),
	);

	for (const result of sourceResults) {
		if (result.error) {
			issues.push({
				type: "source_fetch_failed",
				severity: "error",
				sourceName: result.source.name,
				message: `Failed to fetch furnidata from "${result.source.name}"`,
			});
			continue;
		}
		for (const entry of result.entries) {
			if (!itemByName.has(entry.classname)) {
				missingFromSources.push({
					sourceName: result.source.name,
					sourceId: result.source.id,
					classname: entry.classname,
					itemName: entry.name,
				});
			}
		}
	}

	// Items that a repair attempt could not fix are legacy/broken furniture —
	// surfaced as a separate informational group (not counted as errors) so a
	// fully repaired catalog can reach 0 errors while still listing exactly
	// what is not restorable.

	issues.sort((a, b) => {
		const sev = { error: 0, warning: 1, info: 2 };
		return (sev[a.severity] ?? 0) - (sev[b.severity] ?? 0);
	});

	const unrepairableList: UnrepairableItem[] = [...unrepairable.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([classname, entry]) => ({
			classname,
			itemId: entry.itemId,
			missing: [...entry.missing].sort(),
		}));

	const summary: AuditSummary = {
		totalItemsBase: items.length,
		totalCatalogItems: catalogItems.length,
		missingCatalog: issues.filter((i) => i.type === "missing_catalog").length,
		orphanedCatalog: issues.filter((i) => i.type === "orphaned_catalog").length,
		missingNitro: issues.filter((i) => i.type === "missing_nitro").length,
		missingIcon: issues.filter((i) => i.type === "missing_icon").length,
		duplicates: issues.filter((i) => i.type === "duplicate_classname").length,
		missingFromSourcesTotal: missingFromSources.length,
		unrepairableCount: unrepairableList.length,
		iconsRepaired: repairStats?.succeeded ?? 0,
		iconsStillMissing:
			repairStats?.stillMissing ?? missingIconClassnames.length,
		nitrosRepaired: nitroRepairStats?.succeeded ?? 0,
		nitrosStillMissing:
			nitroRepairStats?.stillMissing ?? missingNitroClassnames.length,
		catalogSqlCount,
		catalogSqlApplied,
		furniDataAdded,
		furniDataDuplicatesRemoved,
		orphanedRemoved,
		orphanedCleaned,
		duplicatesMerged,
		duplicateRowsRemoved,
		remappedReferences,
		furniDataIdConflicts: furniDataIdConflicts.length,
	};

	onEvent?.({
		type: "batch_complete",
		issues,
		missingFromSources,
		unrepairable: unrepairableList,
		summary,
	});
}

/** Read-only integrity report: never invokes import, repair, or directory creation. */
export async function inspectLiveCatalogIntegrity(catalog: "normal" | "bc") {
	const { integrityCatalog, inspectCatalogIntegrity } = await import(
		"./catalog-integrity"
	);
	integrityCatalog(catalog);
	const pagesTable = sql.raw(
		catalog === "bc" ? "catalog_pages_bc" : "catalog_pages",
	);
	const offersTable = sql.raw(
		catalog === "bc" ? "catalog_items_bc" : "catalog_items",
	);
	const [pageResult, itemResult, offerResult] = await Promise.all([
		queryRows<import("./catalog-integrity").IntegrityPage>(
			sql`SELECT id, parent_id AS parentId, caption FROM ${pagesTable} ORDER BY id`,
		),
		queryRows<import("./catalog-integrity").IntegrityItem>(
			sql`SELECT id, item_name, public_name, type, interaction_type FROM items_base ORDER BY id`,
		),
		queryRows<import("./catalog-integrity").IntegrityOffer>(
			sql`SELECT id, page_id AS pageId, item_ids AS itemIds, catalog_name AS name, ${catalog === "bc" ? sql`NULL` : sql`offer_id`} AS offerId FROM ${offersTable} ORDER BY id`,
		),
	]);
	let icons: Set<string> | null = null;
	try {
		const dirs = await getFurniAssetDirs();
		icons = new Set(await readdir(dirs.iconDir));
	} catch {
		/* Unknown asset state is surfaced separately from missing icons. */
	}
	return inspectCatalogIntegrity({
		catalog,
		pages: pageResult,
		items: itemResult,
		offers: offerResult.map((row) => ({
			...row,
			pageId: Number(row.pageId),
			offerId: row.offerId === null ? null : Number(row.offerId),
		})),
		icons,
	});
}
