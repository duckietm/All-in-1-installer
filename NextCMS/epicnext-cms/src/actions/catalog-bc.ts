"use server";

import { revalidatePath } from "next/cache";
import { catalogFailure } from "@/features/catalog/server/errors";
import { deleteCatalogItemsCommand } from "@/features/catalog/server/item-deletes";
import {
	createBcOfferCommand,
	updateBcOfferCommand,
} from "@/features/catalog/server/offer-commands";
import {
	createPageCommand,
	deletePageCommand,
	reorderPagesCommand,
	togglePageCommand,
	updatePageCommand,
} from "@/features/catalog/server/page-commands";
import { sendCatalogUpdate } from "@/features/catalog/server/sync-status";
import { requirePermission } from "@/lib/admin/guard";
import { PERMS } from "@/lib/permissions";
import { withCatalogExport } from "@/lib/services/catalog-git-queue";
import { logStaffActivity } from "@/lib/services/staff-activity";

const BC_PAGE_FIELDS = [
	"caption",
	"parentId",
	"pageLayout",
	"enabled",
	"visible",
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
] as const;

const BC_ITEM_FIELDS = [
	"itemIds",
	"catalogName",
	"orderNumber",
	"extradata",
	"pageId",
] as const;

function pickAllowed(
	fields: Record<string, unknown>,
	allowed: readonly string[],
) {
	const out: Record<string, unknown> = {};
	for (const key of allowed) {
		if (Object.hasOwn(fields, key) && fields[key] !== undefined) {
			out[key] = fields[key];
		}
	}
	return out;
}

export async function updateBcPage({
	id,
	expected,
	...fields
}: { id: number; expected?: Record<string, unknown> } & Record<
	string,
	unknown
>) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		const data = pickAllowed(fields, BC_PAGE_FIELDS);
		if (Object.keys(data).length === 0) {
			return { ok: false as const, error: "No valid fields to update" };
		}
		try {
			await updatePageCommand("bc", id, data, expected, staff.id);
		} catch (error) {
			return { ok: false as const, error: catalogFailure(error).message };
		}
		await sendCatalogUpdate();
		await logStaffActivity({
			staffId: staff.id,
			action: "bc_page_update",
			description: `Updated BC catalog page #${id}`,
			targetType: "catalog_page_bc",
			targetId: id,
		});
		revalidatePath("/admin/catalog/builder-club");
		return { ok: true as const };
	});
}

/**
 * BC offers are deleted through the same keep-and-restore path as normal ones.
 * It used to be a bare `DELETE` here, so a BC deletion was the one catalog
 * mutation with no way back.
 */
export async function deleteBcItem({
	id,
	requestKey,
}: {
	id: number;
	requestKey?: string;
}) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	try {
		return await withCatalogExport(async () => {
			const data: { deleted: number; restoreId: number } =
				await deleteCatalogItemsCommand([id], staff.id, requestKey, "bc");
			await sendCatalogUpdate();
			await logStaffActivity({
				staffId: staff.id,
				action: "bc_item_delete",
				description: `Deleted BC catalog offer #${id}`,
				targetType: "catalog_item_bc",
				targetId: id,
			});
			revalidatePath("/admin/catalog/builder-club");
			return { ok: true as const, data };
		});
	} catch (error) {
		return { ok: false as const, error: catalogFailure(error).message };
	}
}

export async function updateBcItem({
	id,
	...data
}: {
	id: number;
	itemIds?: string;
	catalogName?: string;
	orderNumber?: number;
	extradata?: string;
}) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		const safe = pickAllowed(data as Record<string, unknown>, BC_ITEM_FIELDS);
		if (Object.keys(safe).length === 0) {
			return { ok: false as const, error: "No valid fields to update" };
		}
		try {
			await updateBcOfferCommand(id, safe);
		} catch (error) {
			return { ok: false as const, error: catalogFailure(error).message };
		}
		await sendCatalogUpdate();
		await logStaffActivity({
			staffId: staff.id,
			action: "bc_item_update",
			description: `Updated BC catalog item #${id}`,
			targetType: "catalog_item_bc",
			targetId: id,
		});
		revalidatePath("/admin/catalog/builder-club");
		return { ok: true as const };
	});
}

export async function createBcItem({
	pageId,
	...data
}: {
	pageId: number;
	itemIds: string;
	catalogName: string;
	orderNumber: number;
	extradata: string;
}) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		const createdId = await createBcOfferCommand({ pageId, ...data });
		await sendCatalogUpdate();
		await logStaffActivity({
			staffId: staff.id,
			action: "bc_item_create",
			description: `Created BC catalog item #${createdId}`,
			targetType: "catalog_item_bc",
			targetId: createdId,
		});
		revalidatePath("/admin/catalog/builder-club");
		return { ok: true as const, data: { id: createdId } };
	});
}

export async function toggleBcPage({
	id,
	field,
}: {
	id: number;
	field: "enabled" | "visible";
}) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		await togglePageCommand("bc", id, field, staff.id);
		await sendCatalogUpdate();
		revalidatePath("/admin/catalog/builder-club");
		return { ok: true as const };
	});
}

export async function createBcPage(input: {
	caption: string;
	parentId: number;
	pageLayout?: string;
	iconImage?: number;
	iconColor?: number;
	enabled?: "0" | "1";
	visible?: "0" | "1";
	orderNum?: number;
}) {
	const staff = await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		const createdId = await createPageCommand("bc", {
			caption: input.caption,
			parentId: input.parentId,
			pageLayout: input.pageLayout ?? "default_3x3",
			iconColor: input.iconColor ?? 0,
			iconImage: input.iconImage ?? 0,
			orderNum: input.orderNum ?? 0,
			visible: input.visible ?? "1",
			enabled: input.enabled ?? "1",
			pageHeadline: "",
			pageTeaser: "",
		});
		await sendCatalogUpdate();
		await logStaffActivity({
			staffId: staff.id,
			action: "bc_page_create",
			description: `Created BC catalog page "${input.caption}"`,
			targetType: "catalog_page_bc",
			targetId: createdId,
		});
		revalidatePath("/admin/catalog");
		revalidatePath("/admin/catalog/builder-club");
		return { ok: true as const, data: { id: createdId } };
	});
}

export async function reorderBcTreePage(input: {
	pageId: number;
	newParentId?: number;
	newOrderNum: number;
}) {
	await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		await updatePageCommand("bc", input.pageId, {
			parentId: input.newParentId,
			orderNum: input.newOrderNum,
		});
		await sendCatalogUpdate();
		revalidatePath("/admin/catalog");
		revalidatePath("/admin/catalog/builder-club");
		return { ok: true as const, data: {} };
	});
}

export async function deleteBcTreePage(input: {
	pageId: number;
	mode: "reparent" | "cascade";
}) {
	await requirePermission(PERMS.CATALOG_EDIT);
	return await withCatalogExport(async () => {
		await deletePageCommand("bc", input.pageId, input.mode);
		await sendCatalogUpdate();
		revalidatePath("/admin/catalog");
		revalidatePath("/admin/catalog/builder-club");
		return { ok: true as const, data: {} };
	});
}

export async function reorderBcCatalogPages(input: {
	parentId: number;
	ids: number[];
	expectedIds: number[];
}) {
	await requirePermission(PERMS.CATALOG_EDIT);
	return withCatalogExport(async () => {
		await reorderPagesCommand("bc", input);
		await sendCatalogUpdate();
		revalidatePath("/admin/catalog");
		revalidatePath("/admin/catalog/builder-club");
		return { ok: true as const, data: {} };
	});
}
