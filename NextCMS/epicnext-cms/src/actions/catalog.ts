"use server";

import { inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
	bulkInsertCatalogItems,
	insertCatalogItemRow,
} from "@/actions/catalog-items";
import { catalogFailure } from "@/features/catalog/server/errors";
import {
	createPageCommand,
	deletePageCommand,
	reorderPagesCommand,
	togglePageCommand,
	updatePageCommand,
} from "@/features/catalog/server/page-commands";
import { sendCatalogUpdate } from "@/features/catalog/server/sync-status";
import { requirePermission } from "@/lib/admin/guard";
import { db, ItemsBase, queryRows } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import type { ActionResult } from "@/lib/safe-action-shared";
import { withCatalogExport } from "@/lib/services/catalog-git-queue";
import { logStaffActivity } from "@/lib/services/staff-activity";
import { sqlStringLiteral } from "@/lib/sql-literal";

const CATALOG_PAGE_FIELDS = [
	"caption",
	"parentId",
	"pageLayout",
	"enabled",
	"visible",
	"minRank",
	"clubOnly",
	"vipOnly",
	"orderNum",
	"iconImage",
	"iconColor",
	"pageHeadline",
	"pageTeaser",
	"pageSpecial",
	"pageText1",
	"pageText2",
	"pageTextDetails",
	"pageTextTeaser",
	"includes",
	"captionSave",
] as const;

function pickPageFields(fields: Record<string, unknown>) {
	const out: Record<string, unknown> = {};
	for (const key of CATALOG_PAGE_FIELDS) {
		if (Object.hasOwn(fields, key) && fields[key] !== undefined) {
			out[key] = fields[key];
		}
	}
	return out;
}

export async function updateCatalogPage({
	id,
	expected,
	...fields
}: { id: number; expected?: Record<string, unknown> } & Record<
	string,
	unknown
>): Promise<ActionResult> {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		const data = pickPageFields(fields);
		if (Object.keys(data).length === 0) {
			return { ok: false as const, error: "No valid fields to update" };
		}
		if (typeof data.caption === "string" && !data.captionSave) {
			data.captionSave = data.caption.slice(0, 25);
		}
		try {
			await updatePageCommand("normal", id, data, expected, staff.id);
		} catch (error) {
			return { ok: false as const, error: catalogFailure(error).message };
		}
		await sendCatalogUpdate();
		await logStaffActivity({
			staffId: staff.id,
			action: "catalog_page_update",
			description: `Updated catalog page #${id}`,
			targetType: "catalog_page",
			targetId: id,
		});
		revalidatePath("/admin/catalog");
		return { ok: true as const, data: {} };
	});
}

export async function deleteCatalogPage({ id }: { id: number }) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		await deletePageCommand("normal", id, "reparent");
		await sendCatalogUpdate();
		await logStaffActivity({
			staffId: staff.id,
			action: "catalog_page_delete",
			description: `Deleted catalog page #${id}`,
			targetType: "catalog_page",
			targetId: id,
		});
		revalidatePath("/admin/catalog");
		return { ok: true as const, data: {} };
	});
}

export async function toggleCatalogPage({
	id,
	action,
}: {
	id: number;
	action: "toggleEnabled" | "toggleVisible";
}) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		await togglePageCommand(
			"normal",
			id,
			action === "toggleEnabled" ? "enabled" : "visible",
			staff.id,
		);
		await sendCatalogUpdate();
		revalidatePath("/admin/catalog");
		return { ok: true as const, data: {} };
	});
}

export async function createCatalogPage(input: {
	caption: string;
	parentId: number;
	pageLayout?: string;
	iconImage?: number;
	iconColor?: number;
	enabled?: "0" | "1";
	visible?: "0" | "1";
	minRank?: number;
	orderNum?: number;
}): Promise<ActionResult<{ id: number }>> {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		const createdId = await createPageCommand("normal", {
			caption: input.caption,
			parentId: input.parentId,
			pageLayout: input.pageLayout ?? "default_3x3",
			captionSave: input.caption.slice(0, 25),
			iconColor: input.iconColor ?? 0,
			iconImage: input.iconImage ?? 0,
			minRank: input.minRank ?? 1,
			orderNum: input.orderNum ?? 0,
			visible: input.visible ?? "1",
			enabled: input.enabled ?? "1",
			clubOnly: "0",
			vipOnly: "0",
			pageHeadline: "",
			pageTeaser: "",
			includes: "",
		});
		await sendCatalogUpdate();
		await logStaffActivity({
			staffId: staff.id,
			action: "catalog_page_create",
			description: `Created catalog page "${input.caption}"`,
			targetType: "catalog_page",
			targetId: createdId,
		});
		revalidatePath("/admin/catalog");
		return { ok: true as const, data: { id: createdId } };
	});
}

export async function reorderTreePage(input: {
	pageId: number;
	newParentId?: number;
	newOrderNum: number;
}) {
	await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		await updatePageCommand("normal", input.pageId, {
			parentId: input.newParentId,
			orderNum: input.newOrderNum,
		});
		await sendCatalogUpdate();
		revalidatePath("/admin/catalog");
		return { ok: true as const, data: {} };
	});
}

export async function deleteTreePage(input: {
	pageId: number;
	mode: "reparent" | "cascade";
}) {
	await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		await deletePageCommand("normal", input.pageId, input.mode);
		await sendCatalogUpdate();
		revalidatePath("/admin/catalog");
		return { ok: true as const, data: {} };
	});
}

export async function reorderCatalogPages(input: {
	parentId: number;
	ids: number[];
	expectedIds: number[];
}) {
	await requirePermission(PERMS.CATALOG_EDIT);
	return withCatalogExport(async () => {
		await reorderPagesCommand("normal", input);
		await sendCatalogUpdate();
		revalidatePath("/admin/catalog");
		return { ok: true as const, data: {} };
	});
}

export type CatalogKind = "normal" | "bc";

export async function createAutoCategory(input: {
	kind: CatalogKind;
	parentId: number;
	caption: string;
	pageLayout?: string;
	iconImage?: number;
	enabled?: "0" | "1";
	visible?: "0" | "1";
	minRank?: number;
	offerRows?: Array<{
		baseId: number;
		credits?: number;
		points?: number;
		pointsType?: number;
		amount?: number;
	}>;
}): Promise<ActionResult<{ pageId: number }>> {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		const createResult =
			input.kind === "bc"
				? await createPageCommand("bc", {
						caption: input.caption,
						parentId: input.parentId,
						pageLayout: input.pageLayout ?? "default_3x3",
						captionSave: input.caption.slice(0, 25),
						iconImage: input.iconImage ?? 0,
						iconColor: 0,
						minRank: input.minRank ?? 1,
						orderNum: 0,
						visible: input.visible ?? "1",
						enabled: input.enabled ?? "1",
						clubOnly: "0",
						vipOnly: "0",
						pageHeadline: "",
						pageTeaser: "",
						includes: "",
					})
				: await createPageCommand("normal", {
						caption: input.caption,
						parentId: input.parentId,
						pageLayout: input.pageLayout ?? "default_3x3",
						captionSave: input.caption.slice(0, 25),
						iconImage: input.iconImage ?? 0,
						iconColor: 0,
						minRank: input.minRank ?? 1,
						orderNum: 0,
						visible: input.visible ?? "1",
						enabled: input.enabled ?? "1",
						clubOnly: "0",
						vipOnly: "0",
						pageHeadline: "",
						pageTeaser: "",
						includes: "",
					});

		const pageId = Number(createResult);

		// Create the new page's offers in the same export run (single snapshot).
		if (input.kind === "normal" && (input.offerRows?.length ?? 0) > 0) {
			if ((input.offerRows?.length ?? 0) > 500) {
				return { ok: false as const, error: "Max 500 items per auto category" };
			}

			const rows = input.offerRows ?? [];
			const { created } = await bulkInsertCatalogItems({
				pageId,
				staffId: staff.id,
				rows: rows.map((r) => ({
					baseId: r.baseId,
					credits: r.credits,
					points: r.points,
					pointsType: r.pointsType,
					amount: r.amount,
				})),
			});

			await logStaffActivity({
				staffId: staff.id,
				action: "catalog_items_bulk_create",
				description: `Auto-created ${created} catalog item(s) on page #${pageId}`,
				targetType: "catalog_page",
				targetId: pageId,
			});
		}

		await sendCatalogUpdate();
		await logStaffActivity({
			staffId: staff.id,
			action: "catalog_page_create",
			description: `Created catalog page #${pageId} "${input.caption}" (${input.kind})`,
			targetType: "catalog_page",
			targetId: pageId,
		});
		revalidatePath("/admin/catalog");
		return { ok: true as const, data: { pageId } };
	});
}

const MAX_ORGANIZE_GROUPS = 50;
const MAX_ORGANIZE_ITEMS = 500;

/**
 * One page the run wrote to, described well enough for the client to fold the
 * result into its live catalog tree. `isNew` is false when the group reused an
 * existing destination, in which case the page already exists and every field
 * that describes a *new* page (`parentId`, `pageLayout`, the icon) is only the
 * requested value, not a verified read-back of the stored row.
 */
export interface OrganizedPageChange {
	pageId: number;
	caption: string;
	parentId: number;
	pageLayout: string;
	iconImage: number;
	iconColor: number;
	orderNum: number;
	visible: string;
	enabled: string;
	isNew: boolean;
	moved: number;
	added: number;
	/** Import pages the offers were taken from, so counts can be rebalanced. */
	movedFrom: Array<{ fromPageId: number; count: number }>;
}

export interface OrganizeImportGroup {
	caption: string;
	pageLayout: string;
	iconImage: number;
	/** When set, items are moved into this existing page instead of creating one. */
	destinationPageId?: number | null;
	items: Array<{
		itemId: number;
		catalogItemId: number | null;
		credits?: number;
		points?: number;
		pointsType?: number;
		amount?: number;
	}>;
}

/**
 * Turn approved import suggestions into real catalog pages in one export
 * snapshot. Offers that already exist inside the imported-furniture tree are
 * moved to the freshly created page; brand-new furniture gets a new offer.
 * Returns per-page move/add counts so the UI can summarize what happened.
 */
export async function organizeImportFurni(input: {
	parentId: number;
	groups: OrganizeImportGroup[];
}): Promise<
	ActionResult<{
		created: OrganizedPageChange[];
	}>
> {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);

	const groups = input.groups.filter((g) => (g.items?.length ?? 0) > 0);
	if (groups.length === 0) {
		return { ok: false as const, error: "No groups selected" };
	}
	if (groups.length > MAX_ORGANIZE_GROUPS) {
		return {
			ok: false as const,
			error: `Max ${MAX_ORGANIZE_GROUPS} groups per run`,
		};
	}
	const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0);
	if (totalItems > MAX_ORGANIZE_ITEMS) {
		return {
			ok: false as const,
			error: `Max ${MAX_ORGANIZE_ITEMS} items per run`,
		};
	}

	return await withCatalogExport(async () => {
		const { getImportedCategoryPageIds } = await import(
			"@/features/catalog/server/import-pages"
		);
		const importPageIds = new Set(await getImportedCategoryPageIds());

		const created: OrganizedPageChange[] = [];
		let totalMoved = 0;
		let totalAdded = 0;

		for (const group of groups) {
			// Either create a fresh page or reuse an existing destination.
			const destinationPageId = group.destinationPageId
				? Number(group.destinationPageId)
				: null;
			if (destinationPageId != null && !Number.isFinite(destinationPageId)) {
				return {
					ok: false as const,
					error: "Invalid destination page id",
				};
			}
			const isNew = destinationPageId == null;
			const pageLayout = group.pageLayout || "default_3x3";
			const iconImage = group.iconImage ?? 0;
			const pageId =
				destinationPageId ??
				Number(
					await createPageCommand("normal", {
						caption: group.caption,
						parentId: input.parentId,
						pageLayout,
						captionSave: group.caption.slice(0, 25),
						iconImage,
						iconColor: 0,
						minRank: 1,
						orderNum: 0,
						visible: "1",
						enabled: "1",
						clubOnly: "0",
						vipOnly: "0",
						pageHeadline: "",
						pageTeaser: "",
						includes: "",
					}),
				);
			let destinationCaption: string | null = null;
			if (destinationPageId) {
				const captionRows = await queryRows<{ caption: string }>(sql`
					SELECT caption FROM catalog_pages WHERE id = ${destinationPageId}
				`);
				destinationCaption = captionRows[0]?.caption ?? null;
			}
			const caption =
				destinationCaption ?? group.caption ?? `Category ${pageId}`;

			// Existing destinations append after their current offers; freshly
			// created pages start at order 1.
			const maxOrder = await queryRows<{ maxOrder: number }>(sql`
				SELECT COALESCE(MAX(order_number), 0) AS maxOrder
				FROM catalog_items WHERE page_id = ${pageId}
			`);
			let nextOrder = Number(maxOrder[0]?.maxOrder ?? 0) + 1;

			const baseIds = [...new Set(group.items.map((r) => r.itemId))];
			const bases = await db
				.select({
					id: ItemsBase.id,
					publicName: ItemsBase.publicName,
					itemName: ItemsBase.itemName,
				})
				.from(ItemsBase)
				.where(inArray(ItemsBase.id, baseIds));
			const baseMap = new Map(bases.map((b) => [b.id, b]));

			// Verify every offer we're about to move still sits inside the import
			// tree in ONE query, so we never hijack an unrelated catalog offer.
			const moverIds = [
				...new Set(
					group.items
						.map((r) => Number(r.catalogItemId))
						.filter((n) => Number.isFinite(n) && n > 0),
				),
			];
			const validMoveIds = new Set<number>();
			const hostPageByItemId = new Map<number, number>();
			if (moverIds.length > 0) {
				const hostRows = await queryRows<{ id: number; page_id: number }>(sql`
					SELECT id, page_id FROM catalog_items WHERE id IN (${sql.join(
						moverIds.map((id) => sql`${id}`),
						sql`, `,
					)})
				`);
				for (const row of hostRows) {
					const pageId = Number(row.page_id);
					if (importPageIds.has(pageId)) {
						validMoveIds.add(Number(row.id));
						hostPageByItemId.set(Number(row.id), pageId);
					}
				}
			}

			let moved = 0;
			let added = 0;
			const movedFromCounts = new Map<number, number>();

			const moveCaseOrder: string[] = [];
			const moveCaseName: string[] = [];
			const moveIds: number[] = [];
			for (const row of group.items) {
				const base = baseMap.get(row.itemId);
				if (!base) continue;
				const catalogName =
					base.publicName || base.itemName || String(row.itemId);

				if (row.catalogItemId) {
					if (!validMoveIds.has(Number(row.catalogItemId))) {
						// Offer no longer lives in the import tree (moved elsewhere or
						// deleted) — skip it instead of duplicating it.
						continue;
					}
					moveCaseOrder.push(
						`WHEN ${Number(row.catalogItemId)} THEN ${nextOrder}`,
					);
					moveCaseName.push(
						`WHEN ${Number(row.catalogItemId)} THEN ${sqlStringLiteral(catalogName)}`,
					);
					moveIds.push(Number(row.catalogItemId));
					const hostPageId = hostPageByItemId.get(Number(row.catalogItemId));
					if (hostPageId != null) {
						movedFromCounts.set(
							hostPageId,
							(movedFromCounts.get(hostPageId) ?? 0) + 1,
						);
					}
					moved++;
				} else {
					await insertCatalogItemRow({
						pageId,
						itemIds: String(row.itemId),
						catalogName,
						costCredits: row.credits ?? 0,
						costPoints: row.points ?? 0,
						pointsType: row.pointsType ?? 0,
						amount: row.amount ?? 1,
						limitedSells: 0,
						limitedStack: 0,
						orderNumber: nextOrder,
						offerId: -1,
						songId: 0,
						haveOffer: "1",
						clubOnly: "0",
						extradata: "",
					});
					added++;
				}
				nextOrder++;
			}

			if (moveIds.length > 0) {
				// Preserve existing offer names when moving into an existing
				// destination; freshly created pages get the base item's name.
				const nameUpdate =
					destinationPageId == null
						? sql`, catalog_name = CASE id ${sql.raw(moveCaseName.join(" "))} END`
						: sql``;
				await db.execute(sql`
					UPDATE catalog_items
					SET page_id = ${pageId},
					    order_number = CASE id ${sql.raw(moveCaseOrder.join(" "))} END
					    ${nameUpdate}
					WHERE id IN (${sql.join(
						moveIds.map((id) => sql`${id}`),
						sql`, `,
					)})
				`);
			}

			await logStaffActivity({
				staffId: staff.id,
				action: destinationPageId
					? "catalog_items_bulk_update"
					: "catalog_page_create",
				description: `Organized import into page #${pageId} "${caption}" (${moved} moved, ${added} added)`,
				targetType: "catalog_page",
				targetId: pageId,
			});
			created.push({
				pageId,
				caption,
				parentId: input.parentId,
				pageLayout,
				iconImage,
				iconColor: 0,
				orderNum: 0,
				visible: "1",
				enabled: "1",
				isNew,
				moved,
				added,
				movedFrom: [...movedFromCounts].map(([fromPageId, count]) => ({
					fromPageId,
					count,
				})),
			});
			totalMoved += moved;
			totalAdded += added;
		}

		await sendCatalogUpdate();
		await logStaffActivity({
			staffId: staff.id,
			action: "catalog_import_organize",
			description: `Organized ${created.length} import page(s): ${totalMoved} offer(s) moved, ${totalAdded} offer(s) added`,
			targetType: "catalog",
		});
		revalidatePath("/admin/catalog");
		return { ok: true as const, data: { created } };
	});
}
