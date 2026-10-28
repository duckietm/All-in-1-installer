"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { db, WebsiteBadges } from "@/lib/db";
import { PERMS } from "@/lib/permissions";

export async function getBadgeData({ code }: { code: string }) {
	await requirePermission(PERMS.CATALOG_EDIT);
	const [badge] = await db
		.select({
			badgeName: WebsiteBadges.badgeName,
			badgeDescription: WebsiteBadges.badgeDescription,
		})
		.from(WebsiteBadges)
		.where(eq(WebsiteBadges.badgeKey, code))
		.limit(1);
	if (!badge) return { ok: false as const, data: null };
	return {
		ok: true as const,
		data: { name: badge.badgeName, desc: badge.badgeDescription },
	};
}

export async function updateBadge({
	code,
	name,
	desc,
}: {
	code: string;
	name: string;
	desc: string;
}) {
	await requirePermission(PERMS.CATALOG_EDIT);
	const now = new Date();
	await db
		.insert(WebsiteBadges)
		.values({
			badgeKey: code,
			badgeName: name,
			badgeDescription: desc,
			createdAt: now,
			updatedAt: now,
		})
		.onDuplicateKeyUpdate({
			set: {
				badgeName: name,
				badgeDescription: desc,
				updatedAt: now,
			},
		});
	revalidatePath("/admin/import/badges");
}
