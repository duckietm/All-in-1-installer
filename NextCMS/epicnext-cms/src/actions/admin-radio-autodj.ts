"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { db, RadioAutoDjPlaylist } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { logStaffActivity } from "@/lib/services/staff-activity";

// AutoDJ playlist CRUD (radio_auto_dj_playlist). CMS-owned table backing the
// fallback playlist the radio rotates through when no live DJ is streaming.
// Faithful to AtomCMS: a flat list of tracks ordered by sort_order then title.

// ── Helpers ──────────────────────────────────────────────────────────────

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

/** Checkbox/select truthiness: '1', 'true', 'on' → true. */
function bool(raw: FormDataEntryValue | null): boolean {
	const v = str(raw).trim().toLowerCase();
	return v === "1" || v === "true" || v === "on";
}

/** Parse a non-negative UnsignedInt, falling back to 0. */
function reqUInt(raw: FormDataEntryValue | null): number {
	const n = Number(str(raw).trim());
	if (!Number.isFinite(n) || n < 0) return 0;
	return Math.trunc(n);
}

/** Parse an optional non-negative UnsignedInt; blank/invalid/negative → null. */
function optUInt(raw: FormDataEntryValue | null): number | null {
	const s = str(raw).trim();
	if (s === "") return null;
	const n = Number(s);
	if (!Number.isFinite(n) || n < 0) return null;
	return Math.trunc(n);
}

// ── AutoDJ playlist CRUD (radio_auto_dj_playlist) ────────────────────────

export async function createTrack(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.RADIO_EDIT);
	const title = str(formData.get("title")).trim().slice(0, 255);
	if (!title) return;

	const artist = str(formData.get("artist")).trim().slice(0, 255);
	const album = str(formData.get("album")).trim().slice(0, 255);
	const artworkUrl = str(formData.get("artworkUrl")).trim().slice(0, 255);
	const duration = optUInt(formData.get("duration"));
	const sortOrder = reqUInt(formData.get("sortOrder"));
	const isActive = bool(formData.get("isActive"));
	const now = new Date();

	try {
		const [result] = await db.insert(RadioAutoDjPlaylist).values({
			title,
			artist: artist || null,
			album: album || null,
			artworkUrl: artworkUrl || null,
			duration,
			sortOrder,
			isActive,
			createdAt: now,
			updatedAt: now,
		});
		const createdId = Number(result.insertId);
		await logStaffActivity({
			staffId: staff.id,
			action: "radio_autodj_create",
			description: `Created AutoDJ track "${title}"${artist ? ` by ${artist}` : ""}`,
			targetType: "radio_auto_dj_track",
			targetId: createdId,
		});
	} catch {
		// Fail soft — DB unavailable; re-render without throwing.
	}
	revalidatePath("/admin/radio/autodj");
}

export async function toggleTrack(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.RADIO_EDIT);
	const id = parseId(formData.get("id"));
	if (id === null) return;

	// The form posts the desired next state so the toggle is idempotent.
	const isActive = bool(formData.get("isActive"));

	try {
		await db
			.update(RadioAutoDjPlaylist)
			.set({ isActive, updatedAt: new Date() })
			.where(eq(RadioAutoDjPlaylist.id, id));
		await logStaffActivity({
			staffId: staff.id,
			action: "radio_autodj_toggle",
			description: `${isActive ? "Activated" : "Deactivated"} AutoDJ track #${id}`,
			targetType: "radio_auto_dj_track",
			targetId: Number(id),
		});
	} catch {
		// Row may be gone; ignore.
	}
	revalidatePath("/admin/radio/autodj");
}

export async function deleteTrack(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.RADIO_EDIT);
	const id = parseId(formData.get("id"));
	if (id === null) return;

	try {
		await db.delete(RadioAutoDjPlaylist).where(eq(RadioAutoDjPlaylist.id, id));
		await logStaffActivity({
			staffId: staff.id,
			action: "radio_autodj_delete",
			description: `Deleted AutoDJ track #${id}`,
			targetType: "radio_auto_dj_track",
			targetId: Number(id),
		});
	} catch {
		// Already deleted; ignore.
	}
	revalidatePath("/admin/radio/autodj");
}
