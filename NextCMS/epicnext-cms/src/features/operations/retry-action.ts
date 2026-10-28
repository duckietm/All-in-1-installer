"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { logger } from "@/lib/logger";
import { PERMS } from "@/lib/permission-slugs";
import { logAudit } from "@/lib/services/audit";
import { retryEffect } from "./server";
export async function retryDelivery(id: string) {
	const staff = await requirePermission(PERMS.DEVOPS_EDIT);
	try {
		await retryEffect(id);
	} catch {
		return {
			ok: false as const,
			error: "Delivery could not be retried. Refresh and try again.",
		};
	}
	await logAudit({
		userId: staff.id,
		action: "operation_delivery_retry",
		target: "operations",
		after: { deliveryId: id },
	}).catch((error) =>
		logger.error("Delivery retried; audit failed", {
			module: "operations",
			error,
		}),
	);
	try {
		revalidatePath("/admin/devops/deliveries");
	} catch {
		/* Delivery retry remains saved. */
	}
	return { ok: true as const, data: {} };
}
