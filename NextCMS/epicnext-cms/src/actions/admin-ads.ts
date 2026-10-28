"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/admin/guard";
import { db, WebsiteAds } from "@/lib/db";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permissions";
import { adminAction } from "@/lib/safe-action";
import { ActionError, actionOk } from "@/lib/safe-action-shared";
import { logStaffActivity } from "@/lib/services/staff-activity";

// CRUD for website advertisements (website_ads). Emulator does not own this
// table; it only stores an image URL rendered in the site layout/widgets.

export async function createAd(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.PAGES_EDIT);
	const image = String(formData.get("image") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	if (!image) return;

	const now = new Date();
	try {
		const [result] = await db.insert(WebsiteAds).values({
			image,
			createdAt: now,
			updatedAt: now,
		});
		await logStaffActivity({
			staffId: staff.id,
			action: "ad_create",
			description: `Created advertisement #${result.insertId} (${image})`,
			targetType: "website_ad",
			targetId: Number(result.insertId),
		});
	} catch (err) {
		logger.error("Action failed: createAd", {
			action: "createAd",
			error: err instanceof Error ? err.message : "DB error",
		});
		revalidatePath("/admin/ads");
		return;
	}
	redirect("/admin/ads");
}

export async function updateAd(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.PAGES_EDIT);
	const raw = String(formData.get("id") ?? "").normalize("NFC");
	if (!/^\d+$/.test(raw)) return;
	const id = BigInt(raw);
	const image = String(formData.get("image") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	if (!image) return;

	try {
		await db
			.update(WebsiteAds)
			.set({ image, updatedAt: new Date() })
			.where(eq(WebsiteAds.id, id));
		await logStaffActivity({
			staffId: staff.id,
			action: "ad_update",
			description: `Updated advertisement #${id} (${image})`,
			targetType: "website_ad",
			targetId: Number(id),
		});
	} catch (err) {
		logger.error("Action failed: updateAd", {
			action: "updateAd",
			id: Number(id),
			error: err instanceof Error ? err.message : "DB error",
		});
		revalidatePath(`/admin/ads/${id}`);
		return;
	}
	redirect("/admin/ads");
}

const deleteAdInput = z.object({
	id: z
		.union([z.string(), z.number(), z.bigint()])
		.transform((v) => BigInt(String(v))),
});

export const deleteAd = adminAction(
	{ permission: PERMS.PAGES_EDIT, schema: deleteAdInput },
	async (ctx) => {
		const id = ctx.data.id;
		try {
			const [result] = await db.delete(WebsiteAds).where(eq(WebsiteAds.id, id));
			if (!result.affectedRows) {
				throw new ActionError("Advertisement not found");
			}
		} catch (err) {
			if (err instanceof ActionError) throw err;
			throw new ActionError("Advertisement not found");
		}
		await logStaffActivity({
			staffId: Number(ctx.session.user.id),
			action: "ad_delete",
			description: `Deleted advertisement #${id}`,
			targetType: "website_ad",
			targetId: Number(id),
		});
		revalidatePath("/admin/ads");
		return actionOk();
	},
);
