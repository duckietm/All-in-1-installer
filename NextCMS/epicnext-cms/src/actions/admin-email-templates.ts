"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { db, EmailTemplates } from "@/lib/db";
import { formPositiveBigInt } from "@/lib/form-data";
import { PERMS } from "@/lib/permissions";

export async function createEmailTemplate(formData: FormData): Promise<void> {
	await requirePermission(PERMS.PAGES_EDIT);
	const name = String(formData.get("name") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	const subject = String(formData.get("subject") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	const body = String(formData.get("body") ?? "").normalize("NFC");
	const variablesRaw = String(formData.get("variables") ?? "")
		.normalize("NFC")
		.trim();
	const isActive = formData.get("isActive") != null;
	if (!name || !subject || !body) return;

	await db.insert(EmailTemplates).values({
		name,
		subject,
		body,
		variables: variablesRaw || null,
		isActive,
	});
	revalidatePath("/admin/email-templates");
}

export async function updateEmailTemplate(formData: FormData): Promise<void> {
	await requirePermission(PERMS.PAGES_EDIT);
	const raw = String(formData.get("id") ?? "").normalize("NFC");
	if (!raw) return;
	let id: bigint;
	try {
		id = BigInt(raw);
	} catch {
		return;
	}
	const subject = String(formData.get("subject") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	const body = String(formData.get("body") ?? "").normalize("NFC");
	const variablesRaw = String(formData.get("variables") ?? "")
		.normalize("NFC")
		.trim();
	const isActive = formData.get("isActive") != null;
	if (!subject || !body) return;

	await db
		.update(EmailTemplates)
		.set({
			subject,
			body,
			variables: variablesRaw || null,
			isActive,
		})
		.where(eq(EmailTemplates.id, id));
	revalidatePath("/admin/email-templates");
}

export async function deleteEmailTemplate(formData: FormData): Promise<void> {
	await requirePermission(PERMS.PAGES_EDIT);
	const id = formPositiveBigInt(formData, "id");
	if (!id) return;
	await db.delete(EmailTemplates).where(eq(EmailTemplates.id, id));
	revalidatePath("/admin/email-templates");
}
