"use server";

import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermissionRateLimited } from "@/lib/admin/guard";
import {
	db,
	GuildForumViews,
	Guilds,
	GuildsForumsComments,
	GuildsForumsThreads,
	GuildsMembers,
	Items,
	Rooms,
} from "@/lib/db";
import { EDGE_CACHE_TAGS, purgeEdgeCache } from "@/lib/edge-cache";
import { PERMS } from "@/lib/permissions";
import { logStaffActivity } from "@/lib/services/staff-activity";

const GUILD_STATES = [0, 1, 2] as const;
const GUILD_FORUM = ["0", "1"] as const;
const GUILD_FORUM_ACCESS = [
	"EVERYONE",
	"OWNER",
	"ADMIN",
	"MEMBER",
	"NONE",
] as const;
const GUILD_MOD_ACCESS = ["ADMINS", "OWNER", "MEMBER", "NONE"] as const;

function parseGuildState(raw: unknown): number | null {
	const value = Number(raw);
	return (GUILD_STATES as readonly number[]).includes(value) ? value : null;
}

function parseEnum<T extends string>(
	raw: unknown,
	allowed: readonly T[],
	fallback: T,
): T {
	const value = String(raw ?? fallback).trim();
	return (allowed as readonly string[]).includes(value)
		? (value as T)
		: fallback;
}

/** Disband a guild and clean related membership/forum rows. */
export async function disbandGuild(formData: FormData): Promise<void> {
	const staff = await requirePermissionRateLimited(PERMS.USERS_EDIT);
	const id = Number(formData.get("id"));
	if (!(id > 0)) return;

	const [guild] = await db
		.select({
			id: Guilds.id,
			name: Guilds.name,
			userId: Guilds.userId,
		})
		.from(Guilds)
		.where(eq(Guilds.id, id))
		.limit(1);
	if (!guild) return;

	await db.transaction(async (tx) => {
		const threads = await tx
			.select({ id: GuildsForumsThreads.id })
			.from(GuildsForumsThreads)
			.where(eq(GuildsForumsThreads.guildId, id));
		const threadIds = threads.map((t) => t.id);
		if (threadIds.length > 0) {
			await tx
				.delete(GuildsForumsComments)
				.where(inArray(GuildsForumsComments.threadId, threadIds));
			await tx
				.delete(GuildsForumsThreads)
				.where(eq(GuildsForumsThreads.guildId, id));
		}
		await tx.delete(GuildForumViews).where(eq(GuildForumViews.guildId, id));
		await tx.delete(GuildsMembers).where(eq(GuildsMembers.guildId, id));
		await tx.update(Rooms).set({ guildId: 0 }).where(eq(Rooms.guildId, id));
		await tx.update(Items).set({ guildId: 0 }).where(eq(Items.guildId, id));
		await tx.delete(Guilds).where(eq(Guilds.id, id));
	});

	await logStaffActivity({
		staffId: staff.id,
		action: "guild_disband",
		description: `Disbanded guild #${id} (${guild.name}), owner #${guild.userId}`,
		targetType: "guild",
		targetId: id,
	});
	revalidatePath("/admin/guilds");
	void purgeEdgeCache([EDGE_CACHE_TAGS.public], "guild disbanded");
}

export async function updateGuild(formData: FormData): Promise<void> {
	const staff = await requirePermissionRateLimited(PERMS.USERS_EDIT);
	const id = Number(formData.get("id"));
	if (!(id > 0)) return;

	const name = String(formData.get("name") ?? "")
		.trim()
		.slice(0, 50);
	if (!name) return;
	const description = String(formData.get("description") ?? "")
		.trim()
		.slice(0, 250);
	const state = parseGuildState(formData.get("state"));
	if (state === null) return;
	const forum = parseEnum(formData.get("forum"), GUILD_FORUM, "0");
	const readForum = parseEnum(
		formData.get("readForum"),
		GUILD_FORUM_ACCESS,
		"EVERYONE",
	);
	const postMessages = parseEnum(
		formData.get("postMessages"),
		GUILD_FORUM_ACCESS,
		"EVERYONE",
	);
	const postThreads = parseEnum(
		formData.get("postThreads"),
		GUILD_FORUM_ACCESS,
		"EVERYONE",
	);
	const modForum = parseEnum(
		formData.get("modForum"),
		GUILD_MOD_ACCESS,
		"ADMINS",
	);

	await db
		.update(Guilds)
		.set({
			name,
			description,
			state,
			forum,
			readForum,
			postMessages,
			postThreads,
			modForum,
		})
		.where(eq(Guilds.id, id));

	await logStaffActivity({
		staffId: staff.id,
		action: "guild_update",
		description: `Updated guild #${id}`,
		targetType: "guild",
		targetId: id,
	});

	revalidatePath("/admin/guilds");
	revalidatePath(`/admin/guilds/${id}`);
	void purgeEdgeCache([EDGE_CACHE_TAGS.public], "guild updated");
}
