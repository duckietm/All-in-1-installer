"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { db, RadioShouts } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { logStaffActivity } from "@/lib/services/staff-activity";

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

/**
 * Delete a radio shout from the DJ moderation page. Re-reads auth via
 * requireStaff, writes a staff-activity audit entry and revalidates the
 * moderation route. Fails soft if the row is already gone.
 */
export async function deleteShout(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.RADIO_EDIT);
	const id = parseId(formData.get("id"));
	if (id === null) return;

	try {
		await db.delete(RadioShouts).where(eq(RadioShouts.id, id));
		await logStaffActivity({
			staffId: staff.id,
			action: "radio.shout.delete",
			description: `Deleted radio shout #${id}`,
			targetType: "radio_shout",
			targetId: Number(id),
		});
	} catch {
		// Row may already be gone; ignore so the action does not throw.
	}

	revalidatePath("/admin/radio/moderation");
}
