"use server";

import { and, eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { db, UserWatch } from "@/lib/db";
import { PERMS } from "@/lib/permission-slugs";
import { adminAction } from "@/lib/safe-action";
import { actionOk } from "@/lib/safe-action-shared";

const toggleWatchSchema = z.object({
	targetUserId: z.coerce.number().int().positive(),
	reason: z.string().max(255).optional(),
});

/**
 * Toggle a watch entry for the calling staff on the given target user.
 * If a row already exists it's removed; otherwise it's created with the
 * provided reason (defaulting to empty). Returns the resulting state so
 * the UI can flip the badge without re-fetching.
 */
export const toggleUserWatch = adminAction(
	{ permission: PERMS.USERS_VIEW, schema: toggleWatchSchema },
	async (ctx) => {
		const staffId = ctx.session.user.id;
		const { targetUserId, reason } = ctx.data;

		const [existing] = await db
			.select({ id: UserWatch.id })
			.from(UserWatch)
			.where(
				and(
					eq(UserWatch.staffId, staffId),
					eq(UserWatch.targetUserId, targetUserId),
				),
			)
			.limit(1);

		if (existing) {
			await db.delete(UserWatch).where(eq(UserWatch.id, existing.id));
			revalidateTag(`user-watch:${staffId}`, { expire: 0 });
			return actionOk({ watching: false });
		}

		await db.insert(UserWatch).values({
			staffId,
			targetUserId,
			reason: reason ?? "",
		});
		revalidateTag(`user-watch:${staffId}`, { expire: 0 });
		return actionOk({ watching: true });
	},
);
