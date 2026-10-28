"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/admin/guard";
import { db, WebsiteShopArticles } from "@/lib/db";
import { EDGE_CACHE_TAGS, purgeEdgeCache } from "@/lib/edge-cache";
import { formPositiveBigInt } from "@/lib/form-data";
import { PERMS } from "@/lib/permissions";
import { logServerError } from "@/lib/server-log";
import { logStaffActivity } from "@/lib/services/staff-activity";

// Website store packages (website_shop_articles). This CMS-owned table backs
// the public store; rows here are the buyable packages, not orders. The closest
// "orders" record is website_paypal_transactions, exposed read-only by the page.

/** Parse an UnsignedInt form value, returning null when blank/invalid/negative. */
function optUInt(formData: FormData, key: string): number | null {
	const raw = String(formData.get(key) ?? "")
		.normalize("NFC")
		.trim();
	if (raw === "") return null;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) return null;
	return Math.floor(n);
}

/** Parse a required non-negative UnsignedInt, falling back to 0. */
function reqUInt(formData: FormData, key: string): number {
	const n = optUInt(formData, key);
	return n ?? 0;
}

export async function createShopArticle(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.SHOP_EDIT);

	const name = String(formData.get("name") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	if (!name) return;

	const now = new Date();
	const costs = reqUInt(formData, "costs");
	try {
		const [result] = await db.insert(WebsiteShopArticles).values({
			name,
			info: String(formData.get("info") ?? "")
				.normalize("NFC")
				.trim()
				.slice(0, 255),
			iconUrl: String(formData.get("icon") ?? "")
				.normalize("NFC")
				.trim()
				.slice(0, 255),
			color: String(formData.get("color") ?? "")
				.normalize("NFC")
				.trim()
				.slice(0, 255),
			costs,
			giveRank: optUInt(formData, "giveRank"),
			credits: optUInt(formData, "credits"),
			duckets: optUInt(formData, "duckets"),
			diamonds: optUInt(formData, "diamonds"),
			badges:
				String(formData.get("badges") ?? "")
					.normalize("NFC")
					.trim()
					.slice(0, 255) || null,
			position: reqUInt(formData, "position"),
			createdAt: now,
			updatedAt: now,
		});
		await logStaffActivity({
			staffId: staff.id,
			action: "shop_create",
			description: `Created shop package "${name}" (${costs} costs)`,
			targetType: "shop_article",
			targetId: Number(result.insertId),
		});
	} catch (error) {
		logServerError("admin.shop_create_failed", error, {
			staffId: staff.id,
			name,
		});
		// Unique constraint on `name` (or DB unavailable) — swallow and re-render.
		return;
	}

	redirect("/admin/shop");
}

export async function updateShopArticle(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.SHOP_EDIT);

	const id = formPositiveBigInt(formData, "id");
	if (!id) return;

	const name = String(formData.get("name") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	if (!name) return;

	try {
		await db
			.update(WebsiteShopArticles)
			.set({
				name,
				info: String(formData.get("info") ?? "")
					.normalize("NFC")
					.trim()
					.slice(0, 255),
				iconUrl: String(formData.get("icon") ?? "")
					.normalize("NFC")
					.trim()
					.slice(0, 255),
				color: String(formData.get("color") ?? "")
					.normalize("NFC")
					.trim()
					.slice(0, 255),
				costs: reqUInt(formData, "costs"),
				giveRank: optUInt(formData, "giveRank"),
				credits: optUInt(formData, "credits"),
				duckets: optUInt(formData, "duckets"),
				diamonds: optUInt(formData, "diamonds"),
				badges:
					String(formData.get("badges") ?? "")
						.normalize("NFC")
						.trim()
						.slice(0, 255) || null,
				position: reqUInt(formData, "position"),
				updatedAt: new Date(),
			})
			.where(eq(WebsiteShopArticles.id, id));
		await logStaffActivity({
			staffId: staff.id,
			action: "shop_update",
			description: `Updated shop package #${id} ("${name}")`,
			targetType: "shop_article",
			targetId: Number(id),
		});
	} catch (error) {
		logServerError("admin.shop_update_failed", error, {
			staffId: staff.id,
			articleId: String(id),
		});
		return;
	}

	revalidatePath(`/admin/shop/${id}`);
	void purgeEdgeCache([EDGE_CACHE_TAGS.public], "shop article updated");
	redirect("/admin/shop");
}

export async function deleteShopArticle(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.SHOP_EDIT);

	const id = formPositiveBigInt(formData, "id");
	if (!id) return;

	try {
		await db.delete(WebsiteShopArticles).where(eq(WebsiteShopArticles.id, id));
		await logStaffActivity({
			staffId: staff.id,
			action: "shop_delete",
			description: `Deleted shop package #${id}`,
			targetType: "shop_article",
			targetId: Number(id),
		});
	} catch (error) {
		logServerError("admin.shop_delete_failed", error, {
			staffId: staff.id,
			articleId: String(id),
		});
		return;
	}

	void purgeEdgeCache([EDGE_CACHE_TAGS.public], "shop article deleted");
	redirect("/admin/shop");
}
