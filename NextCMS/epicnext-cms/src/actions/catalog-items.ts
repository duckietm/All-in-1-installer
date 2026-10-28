"use server";

import { eq, inArray, like, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { offerPatchSchema } from "@/features/catalog/domain/offer-input";
import { catalogFailure } from "@/features/catalog/server/errors";
import {
	deleteCatalogItemsCommand,
	listRestorableDeletionsCommand,
	restoreDeletedCatalogItemsCommand,
} from "@/features/catalog/server/item-deletes";
import {
	bulkUpdateOffersCommand,
	createOfferCommand,
	moveBcOffersCommand,
	moveOffersCommand,
	reorderBcOffersCommand,
	reorderOffersCommand,
	updateOfferCommand,
} from "@/features/catalog/server/offer-commands";
import { sendCatalogUpdate } from "@/features/catalog/server/sync-status";
import { requirePermission } from "@/lib/admin/guard";
import { CatalogItems, db, ItemsBase, queryRows } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import { withCatalogExport } from "@/lib/services/catalog-git-queue";
import {
	allocateCatalogItemId,
	reserveCatalogItemIds,
} from "@/lib/services/furni-import";
import { logStaffActivity } from "@/lib/services/staff-activity";
import { translateItemsSchema } from "@/lib/validators/catalog";

/** Raw INSERT — catalog_items.id has no AUTO_INCREMENT on real Habbo DBs; page_id is often VARCHAR. */
export async function insertCatalogItemRow(data: {
	pageId: number;
	itemIds: string;
	catalogName: string;
	costCredits: number;
	costPoints: number;
	pointsType: number;
	amount: number;
	orderNumber: number;
	offerId: number;
	songId: number;
	limitedSells: number;
	limitedStack: number;
	extradata: string;
	haveOffer: string;
	clubOnly: string;
}): Promise<number> {
	// Exported from a "use server" file, so it is a public endpoint too: it checks the permission itself.
	await requirePermission(PERMS.CATALOG_EDIT);
	const pageIdStr = String(data.pageId);
	offerPatchSchema.required().parse(data);
	return allocateCatalogItemId((nextId) =>
		createOfferCommand("normal", data, async (tx) => {
			await tx.execute(sql`
      INSERT INTO catalog_items (
        id, page_id, item_ids, catalog_name,
        cost_credits, cost_points, points_type, amount,
        order_number, offer_id, song_id,
        limited_sells, limited_stack, extradata, have_offer, club_only
      ) VALUES (
        ${nextId}, ${pageIdStr}, ${data.itemIds}, ${data.catalogName},
        ${data.costCredits}, ${data.costPoints}, ${data.pointsType}, ${data.amount},
        ${data.orderNumber}, ${data.offerId}, ${data.songId},
        ${data.limitedSells}, ${data.limitedStack}, ${data.extradata},
        ${data.haveOffer}, ${data.clubOnly}
      )
    `);
			return nextId;
		}),
	);
}

export async function createCatalogItem(
	data: {
		pageId: number;
		itemIds: string;
		catalogName: string;
		costCredits: number;
		costPoints: number;
		pointsType: number;
		amount: number;
		orderNumber: number;
		offerId: number;
		limitedSells: number;
		limitedStack: number;
		extradata: string;
		songId: number;
		haveOffer: "0" | "1";
		clubOnly: "0" | "1";
	},
	// The table is shared between both catalogs, and a BC offer has no price or
	// currency columns at all. The catalog decides which command runs rather than
	// letting the table send normal-only fields at a BC row.
	catalog: "normal" | "bc" = "normal",
) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	if (catalog === "bc") {
		const { createBcItem } = await import("@/actions/catalog-bc");
		return createBcItem({
			pageId: data.pageId,
			itemIds: data.itemIds,
			catalogName: data.catalogName,
			orderNumber: data.orderNumber,
			extradata: data.extradata,
		});
	}
	return await withCatalogExport(async () => {
		let catalogName = data.catalogName.trim();
		if (!catalogName) {
			const firstId = Number.parseInt(data.itemIds.split(";")[0] || "", 10);
			if (firstId > 0) {
				const [base] = await db
					.select({
						publicName: ItemsBase.publicName,
						itemName: ItemsBase.itemName,
					})
					.from(ItemsBase)
					.where(eq(ItemsBase.id, firstId))
					.limit(1);
				catalogName = base?.publicName || base?.itemName || String(firstId);
			}
		}
		const id = await insertCatalogItemRow({ ...data, catalogName });
		await sendCatalogUpdate();
		await logStaffActivity({
			staffId: staff.id,
			action: "catalog_item_create",
			description: `Created catalog item #${id}`,
			targetType: "catalog_item",
			targetId: id,
		});
		revalidatePath("/admin/catalog");
		return { ok: true as const, data: { id } };
	});
}

/**
 * Bulk insert catalog items in ONE transaction instead of N per-item
 * transactions + N INSERT queries. Same result as calling insertCatalogItemRow
 * per row, but far faster for large batches. Side effects (audit, revalidate,
 * RCON refresh) are left to the caller, which wraps this in withCatalogExport.
 */
export async function bulkInsertCatalogItems(data: {
	pageId: number;
	/** Ignored: the signed-in staff member is logged. */
	staffId?: number;
	rows: Array<{
		baseId: number;
		credits?: number;
		points?: number;
		pointsType?: number;
		amount?: number;
	}>;
}): Promise<{ created: number; failed: number }> {
	// Exported from a "use server" file, so it is a public endpoint too: it checks the permission itself,
	// and the audit log names the signed-in staff member, not a caller-supplied id.
	const staffId = (await requirePermission(PERMS.CATALOG_EDIT)).id;
	const { pageId, rows } = data;
	if (rows.length === 0) return { created: 0, failed: 0 };

	const baseIds = [...new Set(rows.map((r) => r.baseId))];
	const bases = await db
		.select({
			id: ItemsBase.id,
			publicName: ItemsBase.publicName,
			itemName: ItemsBase.itemName,
		})
		.from(ItemsBase)
		.where(inArray(ItemsBase.id, baseIds));
	const baseMap = new Map(bases.map((b) => [b.id, b]));

	const ids = await reserveCatalogItemIds(rows.length);

	const maxOrder = await queryRows<{ maxOrder: number }>(sql`
		SELECT COALESCE(MAX(order_number), 0) AS maxOrder FROM catalog_items WHERE page_id = ${String(pageId)}
	`);
	let nextOrder = Number(maxOrder[0]?.maxOrder ?? 0) + 1;

	const values: Array<{
		id: number;
		pageId: string;
		itemIds: string;
		catalogName: string;
		costCredits: number;
		costPoints: number;
		pointsType: number;
		amount: number;
		orderNumber: number;
		offerId: number;
		songId: number;
		limitedSells: number;
		limitedStack: number;
		extradata: string;
		haveOffer: string;
		clubOnly: string;
	}> = [];

	let failed = 0;
	let validIdx = 0;

	for (const row of rows) {
		const base = baseMap.get(row.baseId);
		if (!base) {
			failed++;
			continue;
		}
		values.push({
			id: ids[validIdx],
			pageId: String(pageId),
			itemIds: String(row.baseId),
			catalogName: base.publicName || base.itemName || String(row.baseId),
			costCredits: row.credits ?? 0,
			costPoints: row.points ?? 0,
			pointsType: row.pointsType ?? 0,
			amount: row.amount ?? 1,
			orderNumber: nextOrder++,
			offerId: -1,
			songId: 0,
			limitedSells: 0,
			limitedStack: 0,
			extradata: "",
			haveOffer: "1",
			clubOnly: "0",
		});
		validIdx++;
	}

	if (values.length === 0) return { created: 0, failed };

	const allFurnitureIds = [...new Set(values.map((v) => Number(v.itemIds)))];

	await db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT id FROM catalog_pages WHERE id=${String(pageId)} FOR UPDATE`,
		);
		if (allFurnitureIds.length) {
			await tx.execute(
				sql`SELECT id FROM items_base WHERE id IN (${sql.join(allFurnitureIds, sql`, `)}) ORDER BY id FOR UPDATE`,
			);
		}

		for (const v of values) {
			await tx.execute(sql`
				INSERT INTO catalog_items (
					id, page_id, item_ids, catalog_name,
					cost_credits, cost_points, points_type, amount,
					order_number, offer_id, song_id,
					limited_sells, limited_stack, extradata, have_offer, club_only
				) VALUES (
					${v.id}, ${v.pageId}, ${v.itemIds}, ${v.catalogName},
					${v.costCredits}, ${v.costPoints}, ${v.pointsType}, ${v.amount},
					${v.orderNumber}, ${v.offerId}, ${v.songId},
					${v.limitedSells}, ${v.limitedStack}, ${v.extradata},
					${v.haveOffer}, ${v.clubOnly}
				)
			`);
		}
	});

	await sendCatalogUpdate();
	await logStaffActivity({
		staffId,
		action: "catalog_items_bulk_create",
		description: `Bulk inserted ${values.length} catalog item(s) on page #${pageId}`,
		targetType: "catalog_page",
		targetId: pageId,
	});
	revalidatePath("/admin/catalog");

	return { created: values.length, failed };
}

/** Bulk create with one RCON refresh at the end. */
export async function bulkCreateCatalogItems({
	pageId,
	rows,
}: {
	pageId: number;
	rows: Array<{
		baseId: number;
		credits?: number;
		points?: number;
		pointsType?: number;
	}>;
}) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		if (rows.length === 0) {
			return { ok: true as const, data: { created: 0, failed: 0 } };
		}
		if (rows.length > 500) {
			return { ok: false as const, error: "Max 500 items per bulk import" };
		}

		const { created, failed } = await bulkInsertCatalogItems({
			pageId,
			staffId: staff.id,
			rows: rows.map((r) => ({
				baseId: r.baseId,
				credits: r.credits,
				points: r.points,
				pointsType: r.pointsType,
				amount: 1,
			})),
		});

		return { ok: true as const, data: { created, failed } };
	});
}

/**
 * Deleting offers is the one catalog mutation with no natural inverse, so the
 * full rows are kept at delete time and `restoreId` is handed back. The UI shows
 * that as an undo affordance; without it a mis-click is unrecoverable.
 */
export async function deleteCatalogItems({
	ids,
	requestKey,
	catalog = "normal",
}: {
	ids: number[];
	requestKey?: string;
	catalog?: "normal" | "bc";
}) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	try {
		return await withCatalogExport(async () => {
			const data: {
				deleted: number;
				restoreId: number;
			} = await deleteCatalogItemsCommand(
				ids,
				staff.id,
				requestKey,
				catalog === "bc" ? "bc" : "normal",
			);
			await sendCatalogUpdate();
			await logStaffActivity({
				staffId: staff.id,
				action: "catalog_items_delete",
				description: `Deleted ${data.deleted} ${catalog === "bc" ? "BC " : ""}catalog offer(s): ${ids.join(", ")}`,
				targetType: catalog === "bc" ? "catalog_item_bc" : "catalog_item",
			});
			revalidatePath("/admin/catalog");
			if (catalog === "bc") revalidatePath("/admin/catalog/builder-club");
			return { ok: true as const, data };
		});
	} catch (error) {
		const failure = catalogFailure(error);
		return { ok: false as const, error: failure.message };
	}
}

/**
 * Recent deletions that are still restorable. The undo toast covers the common
 * case; this is the fallback for a delete noticed after that toast is gone.
 */
export async function listRestorableCatalogItemDeletions() {
	await requirePermission(PERMS.CATALOG_EDIT);
	try {
		return {
			ok: true as const,
			data: await listRestorableDeletionsCommand(),
		};
	} catch (error) {
		const failure = catalogFailure(error);
		return { ok: false as const, error: failure.message };
	}
}

export async function restoreDeletedCatalogItems({
	restoreId,
	requestKey,
}: {
	restoreId: number;
	requestKey?: string;
}) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	try {
		return await withCatalogExport(async () => {
			const data: { restored: number } =
				await restoreDeletedCatalogItemsCommand(
					restoreId,
					staff.id,
					requestKey,
				);
			await sendCatalogUpdate();
			await logStaffActivity({
				staffId: staff.id,
				action: "catalog_items_restore",
				description: `Restored ${data.restored} deleted catalog offer(s)`,
				targetType: "catalog_item",
			});
			revalidatePath("/admin/catalog");
			return { ok: true as const, data };
		});
	} catch (error) {
		const failure = catalogFailure(error);
		return { ok: false as const, error: failure.message };
	}
}

export async function moveCatalogItems({
	ids,
	targetPageId,
	catalog = "normal",
}: {
	ids: number[];
	targetPageId: number;
	catalog?: "normal" | "bc";
}) {
	await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		if (ids.length === 0) {
			return { ok: true as const, data: {} };
		}
		// Moving BC offers has to lock a BC category and write the BC table; the
		// normal command would move a row in the wrong catalog.
		if (catalog === "bc") await moveBcOffersCommand(ids, targetPageId);
		else await moveOffersCommand(ids, targetPageId);
		await sendCatalogUpdate();
		revalidatePath("/admin/catalog");
		if (catalog === "bc") revalidatePath("/admin/catalog/builder-club");
		return { ok: true as const, data: {} };
	});
}

export async function reorderCatalogItems({
	orders,
	catalog = "normal",
}: {
	orders: Array<{ id: number; orderNumber: number }>;
	catalog?: "normal" | "bc";
}) {
	await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		if (catalog === "bc") await reorderBcOffersCommand(orders);
		else await reorderOffersCommand(orders);
		await sendCatalogUpdate();
		revalidatePath("/admin/catalog");
		if (catalog === "bc") revalidatePath("/admin/catalog/builder-club");
		return { ok: true as const, data: {} };
	});
}

export async function updateCatalogItem({
	id,
	catalogFields,
	baseItem,
	catalog = "normal",
}: {
	id: number;
	catalogFields: Record<string, unknown>;
	baseItem?: { id: number; fields: Record<string, unknown> };
	catalog?: "normal" | "bc";
}) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	// BC rows have no price, points or currency column. The table is shared, so
	// the catalog is resolved here rather than trusting the caller to strip
	// fields the BC command would reject anyway.
	if (catalog === "bc") {
		const { updateBcItem } = await import("@/actions/catalog-bc");
		return updateBcItem({ id, ...catalogFields });
	}
	return await withCatalogExport(async () => {
		try {
			await updateOfferCommand({ id, catalogFields, baseItem }, staff.id);
		} catch (error) {
			return {
				ok: false as const,
				error:
					error instanceof Error
						? error.message
						: "Unable to update catalog item",
			};
		}
		await sendCatalogUpdate();
		await logStaffActivity({
			staffId: staff.id,
			action: "catalog_item_update",
			description: `Updated catalog item #${id}`,
			targetType: "catalog_item",
			targetId: id,
		});
		revalidatePath("/admin/catalog");
		return { ok: true as const, data: {} };
	});
}

/**
 * "Save All" for the inline table editor. One transaction, one RCON refresh,
 * one audit row — instead of a full per-item round-trip that took tens of
 * seconds on pages with hundreds of edited rows. A failing row rolls back the
 * whole batch, so the editor never ends up half-saved.
 */
export async function updateCatalogItemsBulk({
	updates,
	catalog = "normal",
}: {
	updates: Array<{ id: number; catalogFields: Record<string, unknown> }>;
	catalog?: "normal" | "bc";
}) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	if (!Array.isArray(updates) || updates.length === 0) {
		return { ok: false as const, error: "No items to update" };
	}
	if (updates.length > 500) {
		return { ok: false as const, error: "Max 500 items per bulk update" };
	}
	// BC rows go through their own command per item (no price columns, and the
	// BC command keeps its narrower field set); the loop still saves the
	// per-item RCON refreshes inside one export lock below.
	if (catalog === "bc") {
		const { updateBcItem } = await import("@/actions/catalog-bc");
		return await withCatalogExport(async () => {
			let savedCount = 0;
			let lastError = "";
			for (const update of updates) {
				const result = await updateBcItem({
					id: update.id,
					...(update.catalogFields as {
						itemIds?: string;
						catalogName?: string;
						orderNumber?: number;
						extradata?: string;
					}),
				});
				if (result.ok) savedCount++;
				else lastError = result.error ?? "Unable to update item";
			}
			if (savedCount > 0) {
				await logStaffActivity({
					staffId: staff.id,
					action: "bc_items_bulk_update",
					description: `Updated ${savedCount} BC catalog item(s)`,
					targetType: "catalog_item_bc",
				});
			}
			if (savedCount === 0 && lastError) {
				return { ok: false as const, error: lastError };
			}
			return {
				ok: true as const,
				data: { savedCount, failedCount: updates.length - savedCount },
			};
		});
	}
	return await withCatalogExport(async () => {
		try {
			await bulkUpdateOffersCommand(updates, staff.id);
		} catch (error) {
			return {
				ok: false as const,
				error:
					error instanceof Error
						? error.message
						: "Unable to update catalog items",
			};
		}
		await sendCatalogUpdate();
		await logStaffActivity({
			staffId: staff.id,
			action: "catalog_items_bulk_update",
			description: `Updated ${updates.length} catalog item(s)`,
			targetType: "catalog_item",
		});
		revalidatePath("/admin/catalog");
		return {
			ok: true as const,
			data: { savedCount: updates.length, failedCount: 0 },
		};
	});
}

export async function translateCatalogItems(input: {
	/** `id` is items_base.id (not catalog_items.id) */
	items: Array<{ id: number; publicName: string; description?: string }>;
}) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		const parsed = translateItemsSchema.safeParse(input);
		if (!parsed.success) {
			return {
				ok: false as const,
				error: parsed.error.issues[0]?.message ?? "Invalid translate payload",
			};
		}
		const { items } = parsed.data;
		const { patchFurniEntryNames } = await import("@/lib/services/furni-data");
		const { patchLocalizedFurniDataEntries } = await import(
			"@/lib/services/furni-data-i18n"
		);

		const itemIds = items.map((i) => i.id);
		const allBases = await db
			.select({
				id: ItemsBase.id,
				publicName: ItemsBase.publicName,
				itemName: ItemsBase.itemName,
				type: ItemsBase.type,
				spriteId: ItemsBase.spriteId,
			})
			.from(ItemsBase)
			.where(inArray(ItemsBase.id, itemIds));
		const baseById = new Map(allBases.map((b) => [b.id, b]));

		let namesUpdated = 0;
		let descriptionsUpdated = 0;
		const furniPatches: Array<{
			classname: string;
			itemType: string;
			name?: string;
			description?: string;
			spriteId?: number;
			createIfMissing?: boolean;
		}> = [];
		const localizedEntries: Array<{
			classname: string;
			name?: string;
			description?: string;
		}> = [];
		const nameUpdates: Array<{ id: number; nextName: string }> = [];
		const catalogNameUpdates: Array<{
			idStr: string;
			nextName: string;
		}> = [];

		for (const item of items) {
			const base = baseById.get(item.id);
			if (!base) continue;

			const nextName = item.publicName?.trim() ?? "";
			const nextDesc = item.description ?? "";
			const nameChanged =
				nextName !== "" && nextName !== (base.publicName ?? "");

			if (nameChanged) {
				nameUpdates.push({ id: base.id, nextName });
				catalogNameUpdates.push({
					idStr: String(base.id),
					nextName,
				});
				namesUpdated++;
			}

			if (nextDesc !== "" || nameChanged) {
				descriptionsUpdated += nextDesc !== "" ? 1 : 0;
				const englishName = base.publicName?.trim() || base.itemName || "";
				furniPatches.push({
					classname: base.itemName,
					itemType: base.type || "s",
					name: nextName || base.publicName || base.itemName,
					description: nextDesc,
					spriteId: base.spriteId,
					createIfMissing: true,
				});
				localizedEntries.push({
					classname: base.itemName,
					name: englishName,
					description: nextDesc || undefined,
				});
			}
		}

		// Batch ItemsBase name updates.
		for (const { id, nextName } of nameUpdates) {
			await db
				.update(ItemsBase)
				.set({ publicName: nextName })
				.where(eq(ItemsBase.id, id));
		}

		// Batch CatalogItems name updates: one SELECT + UPDATE per idStr.
		for (const { idStr, nextName } of catalogNameUpdates) {
			const related = await db
				.select({
					id: CatalogItems.id,
					catalogName: CatalogItems.catalogName,
				})
				.from(CatalogItems)
				.where(
					or(
						eq(CatalogItems.itemIds, idStr),
						like(CatalogItems.itemIds, `${idStr};%`),
						like(CatalogItems.itemIds, `%;${idStr};%`),
						like(CatalogItems.itemIds, `%;${idStr}`),
					),
				);
			for (const row of related) {
				if (row.catalogName !== nextName) {
					await db
						.update(CatalogItems)
						.set({ catalogName: nextName })
						.where(eq(CatalogItems.id, row.id));
				}
			}
		}

		const furniResult =
			furniPatches.length > 0
				? await patchFurniEntryNames(furniPatches)
				: { updated: 0, inserted: 0 };
		// `furniResult` needs no follow-up: `patchFurniEntryNames` writes through
		// `writeFurniData`, which resets the shared in-process cache and purges
		// the gamedata edge tag itself.

		if (localizedEntries.length > 0) {
			try {
				await patchLocalizedFurniDataEntries(localizedEntries, true);
			} catch {
				// Best-effort: localized files update is non-critical
			}
		}

		await sendCatalogUpdate();
		await logAudit({
			userId: staff.id,
			action: "items_base_translate",
			target: "ItemsBase",
			after: {
				namesUpdated,
				descriptionsUpdated,
				furniDataUpdated: furniResult.updated > 0,
				furniDataInserted: furniResult.inserted,
			},
		});
		revalidatePath("/admin/catalog");
		return {
			ok: true as const,
			data: {
				namesUpdated,
				descriptionsUpdated,
				furniDataUpdated: furniResult.updated,
				furniDataInserted: furniResult.inserted,
				updated: items.length,
			},
		};
	});
}
