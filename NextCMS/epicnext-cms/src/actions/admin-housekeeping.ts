"use server";

import { asc } from "drizzle-orm";
import { requirePermission } from "@/lib/admin/guard";
import { db, WebsiteHousekeepingPermissions } from "@/lib/db";
import { PERMS } from "@/lib/permissions";

export async function exportPermissions(): Promise<string> {
	await requirePermission(PERMS.SETTINGS_VIEW);

	const perms = await db
		.select({
			permission: WebsiteHousekeepingPermissions.permission,
			minRank: WebsiteHousekeepingPermissions.minRank,
			description: WebsiteHousekeepingPermissions.description,
			groupName: WebsiteHousekeepingPermissions.groupName,
			dependsOn: WebsiteHousekeepingPermissions.dependsOn,
		})
		.from(WebsiteHousekeepingPermissions)
		.orderBy(
			asc(WebsiteHousekeepingPermissions.groupName),
			asc(WebsiteHousekeepingPermissions.permission),
		);

	return JSON.stringify(perms, null, 2);
}
