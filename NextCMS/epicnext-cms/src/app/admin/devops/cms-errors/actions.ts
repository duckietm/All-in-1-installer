"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { ErrorStore } from "@/lib/error-monitor";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
export async function resolveCmsError(data: FormData) {
	const staff = await requirePermission(PERMS.DEVOPS_EDIT);
	await new ErrorStore().resolve(String(data.get("fingerprint") ?? ""));
	await logAudit({
		userId: staff.id,
		action: "cms.error.resolve",
		target: "cms-error",
		after: { fingerprint: String(data.get("fingerprint")) },
	});
	revalidatePath("/admin/devops/cms-errors");
}

export async function assignCmsError(data: FormData) {
	const staff = await requirePermission(PERMS.DEVOPS_EDIT);
	const mode = data.get("assignment");
	if (mode !== "self" && mode !== "clear")
		throw new Error("Invalid assignment operation");
	const fingerprint = String(data.get("fingerprint") ?? "");
	const userId = mode === "self" ? staff.id : null;
	await new ErrorStore().assign(fingerprint, userId);
	await logAudit({
		userId: staff.id,
		action: "cms.error.assign",
		target: "cms-error",
		after: { fingerprint, assignedUserId: userId },
	});
	revalidatePath("/admin/devops/cms-errors");
}
