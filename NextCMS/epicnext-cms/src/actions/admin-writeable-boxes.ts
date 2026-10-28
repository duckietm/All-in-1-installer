"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { db, WebsiteWriteableBoxes } from "@/lib/db";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permissions";
import { logStaffActivity } from "@/lib/services/staff-activity";

// Writeable boxes (website_writeable_boxes). CMS-owned table backing the
// content panels rendered on the public home page. Active boxes (is_active)
// are the ones shown publicly, ordered by `position`.

/** Parse a non-negative Int form value, falling back to 0. */
function reqInt(formData: FormData, key: string): number {
	const raw = String(formData.get(key) ?? "")
		.normalize("NFC")
		.trim();
	if (raw === "") return 0;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) return 0;
	return Math.floor(n);
}

/** Parse the BigInt `id` form value, returning null when blank/invalid. */
function parseId(formData: FormData): bigint | null {
	const raw = String(formData.get("id") ?? "")
		.normalize("NFC")
		.trim();
	if (!raw) return null;
	try {
		return BigInt(raw);
	} catch {
		return null;
	}
}

function revalidate(): void {
	revalidatePath("/admin/writeable-boxes");
	// Active boxes render on the public home page (root layout).
	revalidatePath("/", "layout");
}

export async function createBox(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.PAGES_EDIT);

	const title = String(formData.get("title") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	if (!title) return;

	const now = new Date();
	try {
		const [result] = await db.insert(WebsiteWriteableBoxes).values({
			title,
			icon:
				String(formData.get("icon") ?? "")
					.normalize("NFC")
					.trim()
					.slice(0, 255) || null,
			content: String(formData.get("content") ?? "").normalize("NFC"),
			position: reqInt(formData, "position"),
			isActive: String(formData.get("isActive") ?? "").normalize("NFC") === "1",
			createdAt: now,
			updatedAt: now,
		});
		await logStaffActivity({
			staffId: staff.id,
			action: "writeable_box_create",
			description: `Created writeable box "${title}" (#${result.insertId})`,
			targetType: "writeable_box",
			targetId: Number(result.insertId),
		});
	} catch (err) {
		// DB unavailable — keep the page usable, but record the failure.
		logger.error("Failed to create writeable box", { err });
		return;
	}

	revalidate();
}

export async function updateBox(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.PAGES_EDIT);

	const id = parseId(formData);
	if (id == null) return;

	const title = String(formData.get("title") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	if (!title) return;

	try {
		await db
			.update(WebsiteWriteableBoxes)
			.set({
				title,
				icon:
					String(formData.get("icon") ?? "")
						.normalize("NFC")
						.trim()
						.slice(0, 255) || null,
				content: String(formData.get("content") ?? "").normalize("NFC"),
				position: reqInt(formData, "position"),
				isActive:
					String(formData.get("isActive") ?? "").normalize("NFC") === "1",
				updatedAt: new Date(),
			})
			.where(eq(WebsiteWriteableBoxes.id, id));
		await logStaffActivity({
			staffId: staff.id,
			action: "writeable_box_update",
			description: `Updated writeable box #${id} ("${title}")`,
			targetType: "writeable_box",
			targetId: Number(id),
		});
	} catch (err) {
		logger.error("Failed to persist writeable box", { err });
		return;
	}

	revalidate();
}

export async function deleteBox(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.PAGES_EDIT);

	const id = parseId(formData);
	if (id == null) return;

	try {
		await db
			.delete(WebsiteWriteableBoxes)
			.where(eq(WebsiteWriteableBoxes.id, id));
		await logStaffActivity({
			staffId: staff.id,
			action: "writeable_box_delete",
			description: `Deleted writeable box #${id}`,
			targetType: "writeable_box",
			targetId: Number(id),
		});
	} catch (err) {
		logger.error("Failed to persist writeable box", { err });
		return;
	}

	revalidate();
}

export async function toggleBox(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.PAGES_EDIT);

	const id = parseId(formData);
	if (id == null) return;

	// `next` carries the desired state ("1" to activate, anything else to hide).
	const next = String(formData.get("next") ?? "").normalize("NFC") === "1";

	try {
		await db
			.update(WebsiteWriteableBoxes)
			.set({ isActive: next, updatedAt: new Date() })
			.where(eq(WebsiteWriteableBoxes.id, id));
		await logStaffActivity({
			staffId: staff.id,
			action: "writeable_box_toggle",
			description: `${next ? "Activated" : "Hid"} writeable box #${id}`,
			targetType: "writeable_box",
			targetId: Number(id),
		});
	} catch (err) {
		logger.error("Failed to persist writeable box", { err });
		return;
	}

	revalidate();
}
