"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { AlertLogs, db } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { rcon } from "@/lib/services/rcon";

/**
 * Broadcast a hotel-wide alert to every online user via RCON.
 *
 * Faithful to AtomCMS: the emulator's `hotelalert` command takes a single
 * `message` payload. Staff-gated; the message is trimmed/bounded before send.
 */
export async function sendHotelAlert(formData: FormData): Promise<void> {
	await requirePermission(PERMS.NOTIFICATIONS_EDIT);

	const message = String(formData.get("message") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 1000);
	if (!message) return;

	try {
		await rcon.send("hotelalert", { message });
	} catch {
		// Best-effort delivery (dead socket / emulator offline) — never 500 the
		// admin page. The emulator writes its own alert_logs row on receipt.
	}

	revalidatePath("/admin/alerts");
}

/** Mark every unread ops alert as read. */
export async function markAllAlertsRead(): Promise<void> {
	await requirePermission(PERMS.NOTIFICATIONS_EDIT);
	try {
		await db
			.update(AlertLogs)
			.set({ isRead: true, updatedAt: new Date() })
			.where(eq(AlertLogs.isRead, false));
	} catch {
		/* ignore */
	}
	revalidatePath("/admin/alerts");
}
