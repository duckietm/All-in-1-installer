"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin/guard";
import { db, WebsiteTeams } from "@/lib/db";
import { EDGE_CACHE_TAGS, purgeEdgeCache } from "@/lib/edge-cache";
import { PERMS } from "@/lib/permissions";

export async function createTeam(formData: FormData): Promise<void> {
	await requirePermission(PERMS.USERS_EDIT);

	const rankName = String(formData.get("rankName") ?? "")
		.normalize("NFC")
		.trim();
	if (!rankName) return;

	const badge = String(formData.get("badge") ?? "")
		.normalize("NFC")
		.trim();
	const jobDescription = String(formData.get("jobDescription") ?? "")
		.normalize("NFC")
		.trim();
	const staffColor =
		String(formData.get("staffColor") ?? "")
			.normalize("NFC")
			.trim() || "#327fa8";
	const hiddenRank = formData.get("hiddenRank") === "on";

	const now = new Date();
	await db.insert(WebsiteTeams).values({
		rankName: rankName.slice(0, 255),
		badge: badge ? badge.slice(0, 255) : null,
		jobDescription: jobDescription ? jobDescription.slice(0, 255) : null,
		staffColor: staffColor.slice(0, 255),
		hiddenRank,
		createdAt: now,
		updatedAt: now,
	});

	revalidatePath("/admin/teams");
	void purgeEdgeCache([EDGE_CACHE_TAGS.public], "team edited");
}

export async function deleteTeam(formData: FormData): Promise<void> {
	await requirePermission(PERMS.USERS_EDIT);

	const id = BigInt(String(formData.get("id")));
	await db.delete(WebsiteTeams).where(eq(WebsiteTeams.id, id));

	revalidatePath("/admin/teams");
	void purgeEdgeCache([EDGE_CACHE_TAGS.public], "team edited");
}
