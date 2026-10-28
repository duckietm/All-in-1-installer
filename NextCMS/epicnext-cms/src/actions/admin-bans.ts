"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermissionRateLimited } from "@/lib/admin/guard";
import { tryGuardRank } from "@/lib/admin/rank-guard";
import { Ban, db } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { rcon } from "@/lib/services/rcon";
import { logStaffActivity } from "@/lib/services/staff-activity";

const BAN_TYPES: ReadonlySet<string> = new Set([
	"account",
	"ip",
	"machine",
	"super",
]);
export async function createBan(formData: FormData): Promise<void> {
	const staff = await requirePermissionRateLimited(PERMS.USERS_BAN);
	const userId = Number(formData.get("userId"));
	const reason =
		String(formData.get("reason") ?? "")
			.normalize("NFC")
			.trim()
			.slice(0, 200) || "Banned";
	const hours = Number(formData.get("hours"));
	const type = String(formData.get("type"));
	if (!(userId > 0) || !BAN_TYPES.has(type)) return;

	const guard = await tryGuardRank(userId, staff.rank);
	if (!guard.ok && guard.reason === "rank") {
		redirect("/admin/bans?error=rank");
	}

	const now = Math.floor(Date.now() / 1000);
	// Emulator convention: banExpire 0 = permanent (not a far-future timestamp).
	const banExpire = hours > 0 ? now + Math.floor(hours) * 3600 : 0;

	await db.insert(Ban).values({
		userId,
		ip: "",
		machineId: "",
		userStaffId: staff.id,
		timestamp: now,
		banExpire,
		banReason: reason,
		type: type as "account" | "ip" | "machine" | "super",
		cfhTopic: -1,
	});

	if (guard.ok) await rcon.disconnectUser(userId, guard.target.username);
	await logStaffActivity({
		staffId: staff.id,
		action: "user_ban",
		description: `Banned user #${userId} (${type}, ${hours > 0 ? `${hours}h` : "permanent"}): ${reason}`,
		targetType: "user",
		targetId: userId,
	});
	revalidatePath("/admin/bans");
}

export async function liftBan(formData: FormData): Promise<void> {
	const staff = await requirePermissionRateLimited(PERMS.USERS_BAN);
	const id = Number(formData.get("id"));
	if (id > 0) {
		const [ban] = await db
			.select({ userId: Ban.userId })
			.from(Ban)
			.where(eq(Ban.id, id))
			.limit(1);
		if (ban) {
			const guard = await tryGuardRank(ban.userId, staff.rank);
			if (!guard.ok && guard.reason === "rank") {
				redirect("/admin/bans?error=rank");
			}
		}
		await db.delete(Ban).where(eq(Ban.id, id));
		await logStaffActivity({
			staffId: staff.id,
			action: "ban_lift",
			description: `Lifted ban #${id}`,
		});
	}
	revalidatePath("/admin/bans");
}
