"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { db, WebsiteIpBlacklist, WebsiteIpWhitelist } from "@/lib/db";
import { PERMS } from "@/lib/permissions";

function parseIp(formData: FormData): string {
	return String(formData.get("ipAddress") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
}

function parseAsn(formData: FormData): string | null {
	const asn = String(formData.get("asn") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	return asn || null;
}

export async function addWhitelist(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);
	const ipAddress = parseIp(formData);
	if (!ipAddress) return;
	const asn = parseAsn(formData);
	await db.insert(WebsiteIpWhitelist).values({
		ipAddress,
		asn,
		whitelistAsn: asn != null,
	});
	revalidatePath("/admin/ip");
}

export async function deleteWhitelist(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);
	const raw = String(formData.get("id") ?? "")
		.normalize("NFC")
		.trim();
	if (!raw) return;
	await db
		.delete(WebsiteIpWhitelist)
		.where(eq(WebsiteIpWhitelist.id, BigInt(raw)));
	revalidatePath("/admin/ip");
}

export async function addBlacklist(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);
	const ipAddress = parseIp(formData);
	if (!ipAddress) return;
	const asn = parseAsn(formData);
	await db.insert(WebsiteIpBlacklist).values({
		ipAddress,
		asn,
		blacklistAsn: asn != null,
	});
	revalidatePath("/admin/ip");
}

export async function deleteBlacklist(formData: FormData): Promise<void> {
	await requirePermission(PERMS.SETTINGS_EDIT);
	const raw = String(formData.get("id") ?? "")
		.normalize("NFC")
		.trim();
	if (!raw) return;
	await db
		.delete(WebsiteIpBlacklist)
		.where(eq(WebsiteIpBlacklist.id, BigInt(raw)));
	revalidatePath("/admin/ip");
}
