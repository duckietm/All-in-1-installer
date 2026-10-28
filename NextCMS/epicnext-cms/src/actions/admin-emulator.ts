"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { db, EmulatorSettings, EmulatorTexts } from "@/lib/db";
import { PERMS } from "@/lib/permissions";

// emulator_settings: PK is the string column `key`, payload is `value` (VarChar 512).
// emulator_texts: PK is the string column `key`, payload is `value` (VarChar 4096).
// Both tables are emulator-owned; we only ever read/update existing rows or add new
// keys via upsert. We never migrate or drop them.

export async function updateEmulatorSetting(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);
	const key = String(formData.get("key") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 100);
	const value = String(formData.get("value") ?? "")
		.normalize("NFC")
		.slice(0, 512);
	if (!key) return;
	await db
		.insert(EmulatorSettings)
		.values({ key, value })
		.onDuplicateKeyUpdate({ set: { value } });
	revalidatePath("/admin/emulator");
}

export async function updateEmulatorText(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);
	const key = String(formData.get("key") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 100);
	const value = String(formData.get("value") ?? "")
		.normalize("NFC")
		.slice(0, 4096);
	if (!key) return;
	await db
		.insert(EmulatorTexts)
		.values({ key, value })
		.onDuplicateKeyUpdate({ set: { value } });
	revalidatePath("/admin/emulator");
}
