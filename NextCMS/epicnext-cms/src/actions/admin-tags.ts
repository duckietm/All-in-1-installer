"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { db, Taggables, Tags } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { logStaffActivity } from "@/lib/services/staff-activity";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Parse a FormData field into a positive BigInt id, or null when invalid. */
function parseId(raw: FormDataEntryValue | null): bigint | null {
	if (typeof raw !== "string" || raw.trim() === "") return null;
	try {
		const id = BigInt(raw.trim());
		return id > 0n ? id : null;
	} catch {
		return null;
	}
}

function str(raw: FormDataEntryValue | null): string {
	return typeof raw === "string" ? raw : "";
}

/** Normalise a hex-ish colour into the 10-char background_color column. */
function normaliseColor(raw: string): string {
	const v = raw.trim().slice(0, 10);
	return v || "#888888";
}

// ── Tags CRUD (tags + taggables, AtomCMS article tags/categories) ──────────

export async function createTag(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.PAGES_EDIT);
	const name = str(formData.get("name")).trim().slice(0, 255);
	if (!name) return;

	const backgroundColor = normaliseColor(str(formData.get("backgroundColor")));
	const now = new Date();

	try {
		const [result] = await db.insert(Tags).values({
			name,
			backgroundColor,
			createdAt: now,
			updatedAt: now,
		});
		await logStaffActivity({
			staffId: staff.id,
			action: "tag_create",
			description: `Created tag "${name}" (#${result.insertId})`,
			targetType: "tag",
			targetId: Number(result.insertId),
		});
	} catch {
		// Fail soft — DB unavailable or duplicate.
	}
	revalidatePath("/admin/tags");
}

export async function updateTag(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.PAGES_EDIT);
	const id = parseId(formData.get("id"));
	if (id === null) return;

	const name = str(formData.get("name")).trim().slice(0, 255);
	const backgroundColor = normaliseColor(str(formData.get("backgroundColor")));
	if (!name) return;

	try {
		await db
			.update(Tags)
			.set({ name, backgroundColor, updatedAt: new Date() })
			.where(eq(Tags.id, id));
		await logStaffActivity({
			staffId: staff.id,
			action: "tag_update",
			description: `Updated tag #${id} → "${name}"`,
			targetType: "tag",
			targetId: Number(id),
		});
	} catch {
		// Row may be gone; ignore.
	}
	revalidatePath("/admin/tags");
}

export async function deleteTag(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.PAGES_EDIT);
	const id = parseId(formData.get("id"));
	if (id === null) return;

	try {
		// Remove the tag and any taggable links pointing at it.
		await db.transaction(async (tx) => {
			await tx.delete(Taggables).where(eq(Taggables.tagId, id));
			await tx.delete(Tags).where(eq(Tags.id, id));
		});
		await logStaffActivity({
			staffId: staff.id,
			action: "tag_delete",
			description: `Deleted tag #${id}`,
			targetType: "tag",
			targetId: Number(id),
		});
	} catch {
		// Already deleted; ignore.
	}
	revalidatePath("/admin/tags");
}
