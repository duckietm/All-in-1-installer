"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { db, WebsiteRareValueCategories, WebsiteRareValues } from "@/lib/db";
import { EDGE_CACHE_TAGS, purgeEdgeCache } from "@/lib/edge-cache";
import { formPositiveBigInt } from "@/lib/form-data";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permissions";

export async function createCategory(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SHOP_EDIT);
	const name = String(formData.get("name") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	const badge = String(formData.get("badge") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	const priorityRaw = Number(formData.get("priority"));
	const priority =
		Number.isFinite(priorityRaw) && priorityRaw > 0
			? Math.floor(priorityRaw)
			: 1;
	if (!name || !badge) return;

	try {
		await db.insert(WebsiteRareValueCategories).values({
			name,
			badge,
			priority,
		});
	} catch (err) {
		// Unique name collision or DB error — page re-renders unchanged.
		logger.error("Failed to create rare-value category", { err });
	}
	revalidatePath("/admin/rare-values");
	void purgeEdgeCache([EDGE_CACHE_TAGS.public], "rare values edited");
}

export async function deleteCategory(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SHOP_EDIT);
	const id = formPositiveBigInt(formData, "id");
	if (!id) return;

	try {
		// Remove the category's values first to avoid orphaned rows.
		await db
			.delete(WebsiteRareValues)
			.where(eq(WebsiteRareValues.categoryId, id));
		await db
			.delete(WebsiteRareValueCategories)
			.where(eq(WebsiteRareValueCategories.id, id));
	} catch (err) {
		logger.error("Failed to delete rare value", { err });
	}
	revalidatePath("/admin/rare-values");
	void purgeEdgeCache([EDGE_CACHE_TAGS.public], "rare values edited");
}

export async function createValue(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SHOP_EDIT);
	const categoryId = formPositiveBigInt(formData, "categoryId");
	if (!categoryId) return;

	const name = String(formData.get("name") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	const furnitureIcon = String(formData.get("furnitureIcon") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	if (!name || !furnitureIcon) return;

	const itemIdRaw = Number(formData.get("itemId"));
	const itemId =
		Number.isFinite(itemIdRaw) && itemIdRaw > 0 ? Math.floor(itemIdRaw) : null;

	const creditValueRaw = String(formData.get("creditValue") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	const currencyValueRaw = String(formData.get("currencyValue") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	const currencyType =
		String(formData.get("currencyType") ?? "diamonds")
			.trim()
			.slice(0, 255) || "diamonds";

	try {
		await db.insert(WebsiteRareValues).values({
			categoryId,
			itemId,
			name,
			creditValue: creditValueRaw || null,
			currencyValue: currencyValueRaw || null,
			currencyType,
			furnitureIcon,
		});
	} catch (err) {
		logger.error("Failed to persist rare value", { err });
	}
	revalidatePath("/admin/rare-values");
	void purgeEdgeCache([EDGE_CACHE_TAGS.public], "rare values edited");
}

export async function deleteValue(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SHOP_EDIT);
	const id = formPositiveBigInt(formData, "id");
	if (!id) return;

	try {
		await db.delete(WebsiteRareValues).where(eq(WebsiteRareValues.id, id));
	} catch (err) {
		logger.error("Failed to delete rare value", { err });
	}
	revalidatePath("/admin/rare-values");
	void purgeEdgeCache([EDGE_CACHE_TAGS.public], "rare values edited");
}

export async function updateCategory(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SHOP_EDIT);
	const id = formPositiveBigInt(formData, "id");
	if (!id) return;

	const name = String(formData.get("name") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	const badge = String(formData.get("badge") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	const priorityRaw = Number(formData.get("priority"));
	const priority =
		Number.isFinite(priorityRaw) && priorityRaw > 0
			? Math.floor(priorityRaw)
			: 1;
	if (!name || !badge) return;

	try {
		await db
			.update(WebsiteRareValueCategories)
			.set({ name, badge, priority })
			.where(eq(WebsiteRareValueCategories.id, id));
	} catch (err) {
		logger.error("Failed to update rare-value category", { err });
	}
	revalidatePath("/admin/rare-values");
	void purgeEdgeCache([EDGE_CACHE_TAGS.public], "rare values edited");
}

export async function updateValue(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SHOP_EDIT);
	const id = formPositiveBigInt(formData, "id");
	if (!id) return;

	const categoryId = formPositiveBigInt(formData, "categoryId");

	const name = String(formData.get("name") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	const furnitureIcon = String(formData.get("furnitureIcon") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	if (!name || !furnitureIcon) return;

	const itemIdRaw = Number(formData.get("itemId"));
	const itemId =
		Number.isFinite(itemIdRaw) && itemIdRaw > 0 ? Math.floor(itemIdRaw) : null;

	const creditValueRaw = String(formData.get("creditValue") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	const currencyValueRaw = String(formData.get("currencyValue") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	const currencyType =
		String(formData.get("currencyType") ?? "diamonds")
			.trim()
			.slice(0, 255) || "diamonds";

	try {
		const sets: Record<string, unknown> = {
			name,
			itemId,
			creditValue: creditValueRaw || null,
			currencyValue: currencyValueRaw || null,
			currencyType,
			furnitureIcon,
		};
		if (categoryId) sets.categoryId = categoryId;
		await db
			.update(WebsiteRareValues)
			.set(sets)
			.where(eq(WebsiteRareValues.id, id));
	} catch (err) {
		logger.error("Failed to persist rare value", { err });
	}
	revalidatePath("/admin/rare-values");
	void purgeEdgeCache([EDGE_CACHE_TAGS.public], "rare values edited");
}
