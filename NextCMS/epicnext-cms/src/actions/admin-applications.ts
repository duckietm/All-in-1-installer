"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermissionRateLimited } from "@/lib/admin/guard";
import { db, WebsiteStaffApplications } from "@/lib/db";
import { formPositiveBigInt } from "@/lib/form-data";
import { PERMS } from "@/lib/permissions";
import { logServerError } from "@/lib/server-log";
import { logStaffActivity } from "@/lib/services/staff-activity";

async function removeApplication(id: bigint): Promise<boolean> {
	try {
		await db
			.delete(WebsiteStaffApplications)
			.where(eq(WebsiteStaffApplications.id, id));
		return true;
	} catch (error) {
		logServerError("applications.delete_failed", error, { id: String(id) });
		return false;
	}
}

export async function dismissApplication(formData: FormData): Promise<void> {
	const staff = await requirePermissionRateLimited(PERMS.USERS_EDIT);
	const id = formPositiveBigInt(formData, "id");
	if (!id) return;

	await removeApplication(id);
	await logStaffActivity({
		staffId: staff.id,
		action: "application_dismiss",
		description: `Dismissed staff application #${id}`,
		targetType: "staff_application",
		targetId: Number(id),
	});

	revalidatePath("/admin/applications");
}

export async function approveApplication(formData: FormData): Promise<void> {
	const staff = await requirePermissionRateLimited(PERMS.USERS_EDIT);
	const id = formPositiveBigInt(formData, "id");
	if (!id) return;

	await removeApplication(id);
	await logStaffActivity({
		staffId: staff.id,
		action: "application_approve",
		description: `Approved staff application #${id}`,
		targetType: "staff_application",
		targetId: Number(id),
	});

	revalidatePath("/admin/applications");
}
