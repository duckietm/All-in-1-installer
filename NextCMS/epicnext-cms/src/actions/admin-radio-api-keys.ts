"use server";

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/admin/guard";
import { db, RadioApiKeys } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { logStaffActivity } from "@/lib/services/staff-activity";

// Radio API keys (radio_api_keys). External integrations (AzureCast bridges,
// widgets, bots) authenticate with a server-generated key. The key itself is
// minted here with crypto.randomBytes — never accepted from the form — and the
// `permissions` JSON column is intentionally left untouched by this CMS slice.

function str(raw: FormDataEntryValue | null): string {
	return typeof raw === "string" ? raw : "";
}

/** Parse a BigInt id from a form value, or null when blank/invalid. */
function parseId(raw: FormDataEntryValue | null): bigint | null {
	const s = str(raw).trim();
	if (!s) return null;
	try {
		return BigInt(s);
	} catch {
		return null;
	}
}

/** Clamp a form value to a non-negative integer (defaulting to `fallback`). */
function intOr(raw: FormDataEntryValue | null, fallback: number): number {
	const trimmed = str(raw).trim();
	if (!trimmed) return fallback;
	const n = Number(trimmed);
	if (!Number.isFinite(n) || n < 0) return fallback;
	return Math.floor(n);
}

export async function createApiKey(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.RADIO_EDIT);

	const name = str(formData.get("name")).trim().slice(0, 255);
	if (!name) return;

	const rateLimit = intOr(formData.get("rateLimit"), 300);
	const allowedIps =
		str(formData.get("allowedIps")).trim().slice(0, 255) || null;

	// Server-side key generation — 24 random bytes → 48 hex chars (fits VarChar(64)).
	const key = randomBytes(24).toString("hex");

	const now = new Date();
	try {
		const [result] = await db.insert(RadioApiKeys).values({
			name,
			key,
			allowedIps,
			rateLimit,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const createdId = BigInt(result.insertId);
		await logStaffActivity({
			staffId: staff.id,
			action: "radio_api_key_create",
			description: `Created radio API key "${name}" (#${createdId}, rate limit ${rateLimit})`,
			targetType: "radio_api_key",
			targetId: Number(createdId),
		});
	} catch {
		// Unique-key collision (astronomically unlikely) or DB down — fail soft.
		return;
	}

	revalidatePath("/admin/radio/api-keys");
	redirect("/admin/radio/api-keys?created=1");
}

export async function toggleApiKey(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.RADIO_EDIT);

	const id = parseId(formData.get("id"));
	if (id == null) return;

	try {
		const [existing] = await db
			.select({
				name: RadioApiKeys.name,
				isActive: RadioApiKeys.isActive,
			})
			.from(RadioApiKeys)
			.where(eq(RadioApiKeys.id, id))
			.limit(1);
		if (!existing) return;

		const next = !existing.isActive;
		await db
			.update(RadioApiKeys)
			.set({ isActive: next, updatedAt: new Date() })
			.where(eq(RadioApiKeys.id, id));
		await logStaffActivity({
			staffId: staff.id,
			action: "radio_api_key_toggle",
			description: `${next ? "Activated" : "Deactivated"} radio API key "${existing.name}" (#${id})`,
			targetType: "radio_api_key",
			targetId: Number(id),
		});
	} catch {
		return;
	}

	revalidatePath("/admin/radio/api-keys");
}

export async function deleteApiKey(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.RADIO_EDIT);

	const id = parseId(formData.get("id"));
	if (id == null) return;

	try {
		await db.delete(RadioApiKeys).where(eq(RadioApiKeys.id, id));
		await logStaffActivity({
			staffId: staff.id,
			action: "radio_api_key_delete",
			description: `Deleted radio API key #${id}`,
			targetType: "radio_api_key",
			targetId: Number(id),
		});
	} catch {
		return;
	}

	revalidatePath("/admin/radio/api-keys");
}
