"use server";
import { inArray } from "drizzle-orm";
import { requirePermission } from "@/lib/admin/guard";
import { db, ItemsBase } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
export async function getCatalogPreviewAssets(itemIds: number[]) {
	await requirePermission(PERMS.CATALOG_VIEW);
	if (
		!Array.isArray(itemIds) ||
		itemIds.length > 200 ||
		itemIds.some(
			(id) => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647,
		)
	)
		return { ok: false as const, assets: [] };
	const ids = [...new Set(itemIds)];
	if (!ids.length) return { ok: true as const, assets: [] };
	try {
		const assets = await db
			.select({
				id: ItemsBase.id,
				classname: ItemsBase.itemName,
				name: ItemsBase.publicName,
			})
			.from(ItemsBase)
			.where(inArray(ItemsBase.id, ids));
		return { ok: true as const, assets };
	} catch {
		return { ok: false as const, assets: [] };
	}
}
