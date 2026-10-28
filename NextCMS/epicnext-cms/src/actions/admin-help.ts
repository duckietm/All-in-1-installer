"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/admin/guard";
import { db, WebsiteHelpCenterCategories } from "@/lib/db";
import { formPositiveBigInt } from "@/lib/form-data";
import { canonicalize, sanitizeField } from "@/lib/foundation/security";
import { PERMS } from "@/lib/permissions";
import { logStaffActivity } from "@/lib/services/staff-activity";

// CRUD for help-center FAQ entries (website_help_center_categories). Each entry
// is a titled content block with an optional image and call-to-action button.

function parsePosition(value: FormDataEntryValue | null): number {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

export async function createHelpQuestion(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.PAGES_EDIT);
	const name = sanitizeField(formData.get("name"));
	const content = canonicalize(String(formData.get("content") ?? ""));
	if (!name || !content) return;

	const imageUrl = sanitizeField(formData.get("imageUrl"));
	const buttonText = sanitizeField(formData.get("buttonText"));
	const buttonUrl = sanitizeField(formData.get("buttonUrl"));
	const buttonColor =
		sanitizeField(formData.get("buttonColor"), 16) || "#eeb425";
	const buttonBorderColor =
		sanitizeField(formData.get("buttonBorderColor"), 16) || "#facc15";

	try {
		const [result] = await db.insert(WebsiteHelpCenterCategories).values({
			name,
			content,
			position: parsePosition(formData.get("position")),
			imageUrl: imageUrl || null,
			buttonText: buttonText || null,
			buttonUrl: buttonUrl || null,
			buttonColor,
			buttonBorderColor,
			smallBox: formData.get("smallBox") != null,
		});
		await logStaffActivity({
			staffId: staff.id,
			action: "help_create",
			description: `Created help-center entry #${result.insertId} (${name})`,
			targetType: "help_center_category",
			targetId: Number(result.insertId),
		});
	} catch {
		// Unique name collision or DB error — re-render unchanged with error.
		revalidatePath("/admin/help-questions");
		redirect(
			"/admin/help-questions/new?error=Unique name collision or database error. Please try again.",
		);
	}
	revalidatePath("/admin/help-questions");
	redirect("/admin/help-questions");
}

export async function updateHelpQuestion(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.PAGES_EDIT);
	const id = formPositiveBigInt(formData, "id");
	if (!id) return;

	const name = sanitizeField(formData.get("name"));
	const content = canonicalize(String(formData.get("content") ?? ""));
	if (!name || !content) return;

	const imageUrl = sanitizeField(formData.get("imageUrl"));
	const buttonText = sanitizeField(formData.get("buttonText"));
	const buttonUrl = sanitizeField(formData.get("buttonUrl"));
	const buttonColor =
		sanitizeField(formData.get("buttonColor"), 16) || "#eeb425";
	const buttonBorderColor =
		sanitizeField(formData.get("buttonBorderColor"), 16) || "#facc15";

	try {
		await db
			.update(WebsiteHelpCenterCategories)
			.set({
				name,
				content,
				position: parsePosition(formData.get("position")),
				imageUrl: imageUrl || null,
				buttonText: buttonText || null,
				buttonUrl: buttonUrl || null,
				buttonColor,
				buttonBorderColor,
				smallBox: formData.get("smallBox") != null,
			})
			.where(eq(WebsiteHelpCenterCategories.id, id));
		await logStaffActivity({
			staffId: staff.id,
			action: "help_update",
			description: `Updated help-center entry #${id} (${name})`,
			targetType: "help_center_category",
			targetId: Number(id),
		});
	} catch {
		// Not found, unique collision, or DB error — ignore.
		revalidatePath(`/admin/help-questions/${id}`);
		return;
	}
	redirect("/admin/help-questions");
}

export async function deleteHelpQuestion(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.PAGES_EDIT);
	const id = formPositiveBigInt(formData, "id");
	if (!id) return;

	try {
		await db
			.delete(WebsiteHelpCenterCategories)
			.where(eq(WebsiteHelpCenterCategories.id, id));
		await logStaffActivity({
			staffId: staff.id,
			action: "help_delete",
			description: `Deleted help-center entry #${id}`,
			targetType: "help_center_category",
			targetId: Number(id),
		});
	} catch {
		// Not found or DB error — ignore.
	}
	redirect("/admin/help-questions");
}
