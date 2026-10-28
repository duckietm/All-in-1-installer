"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, queryRows, User } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { adminAction } from "@/lib/safe-action";
import { ActionError, actionOk } from "@/lib/safe-action-shared";
import { logAudit } from "@/lib/services/audit";
import { rcon } from "@/lib/services/rcon";

const PATH = "/admin/commandocentrum";

const RCON_FAIL = "RCON command failed. Is the emulator running?";

/** Currency amounts are capped: unbounded values break the hotel economy. */
const MAX_CURRENCY = 1_000_000;

/** Every mutation here gets an audit entry; rank changes and RCON most of all. */
function auditAction(
	userId: number,
	action: string,
	targetId: number,
	after: Record<string, unknown>,
): void {
	// logAudit is async, so a surrounding try/catch cannot see its rejection —
	// it would surface as an unhandled rejection and, in production, take the
	// request down over a failing audit insert. Swallow it on the promise
	// instead, which is what "auditing must never fail the command it
	// describes" actually requires.
	void Promise.resolve()
		.then(() => logAudit({ userId, action, target: "User", targetId, after }))
		.catch(() => {
			/* auditing must never fail the command it describes */
		});
}

async function requireRconOk(ok: boolean): Promise<void> {
	if (!ok) throw new ActionError(RCON_FAIL);
}

/** Rebuild the in-memory catalog on the emulator (rcon: updatecatalog). */
export const updateCatalog = adminAction(
	{ permission: PERMS.RCON_EXECUTE },
	async () => {
		await requireRconOk(await rcon.updateCatalog());
		revalidatePath(PATH);
		return actionOk();
	},
);

/** Reload the chat word filter on the emulator (rcon: updatewordfilter). */
export const updateWordFilter = adminAction(
	{ permission: PERMS.RCON_EXECUTE },
	async () => {
		await requireRconOk(await rcon.updateWordFilter());
		revalidatePath(PATH);
		return actionOk();
	},
);

/** Reload navigator data on the emulator (rcon: updatenavigator, no payload). */
export const updateNavigator = adminAction(
	{ permission: PERMS.RCON_EXECUTE },
	async () => {
		await requireRconOk(await rcon.send("updatenavigator", null));
		revalidatePath(PATH);
		return actionOk();
	},
);

const hotelAlertSchema = z.object({
	message: z.string().trim().min(1).max(512),
});

/** Broadcast a hotel-wide alert to every connected user (rcon: hotelalert). */
export const hotelAlert = adminAction(
	{ permission: PERMS.RCON_EXECUTE, schema: hotelAlertSchema },
	async (ctx) => {
		const message = ctx.data.message.normalize("NFC");
		await requireRconOk(await rcon.send("hotelalert", { message }));
		revalidatePath(PATH);
		return actionOk();
	},
);

const disconnectSchema = z.object({
	userId: z.coerce.number().int().positive(),
	username: z.string().trim().min(1),
});

/** Disconnect/kick a user from the hotel (rcon: disconnect). */
export const disconnectUser = adminAction(
	{ permission: PERMS.RCON_EXECUTE, schema: disconnectSchema },
	async (ctx) => {
		const username = ctx.data.username.normalize("NFC");
		await requireRconOk(await rcon.disconnectUser(ctx.data.userId, username));
		revalidatePath(PATH);
		return actionOk();
	},
);

const alertUserSchema = z.object({
	userId: z.coerce.number().int().positive(),
	message: z.string().trim().min(1).max(512),
});

/** Send an alert to a specific user (rcon: alertuser). */
export const alertUser = adminAction(
	{ permission: PERMS.RCON_EXECUTE, schema: alertUserSchema },
	async (ctx) => {
		const message = ctx.data.message.normalize("NFC");
		await requireRconOk(await rcon.alertUser(ctx.data.userId, message));
		revalidatePath(PATH);
		return actionOk();
	},
);

const forwardUserSchema = z.object({
	userId: z.coerce.number().int().positive(),
	roomId: z.coerce.number().int().positive(),
});

/** Forward a user to a specific room (rcon: forwarduser). */
export const forwardUser = adminAction(
	{ permission: PERMS.RCON_EXECUTE, schema: forwardUserSchema },
	async (ctx) => {
		await requireRconOk(
			await rcon.forwardUser(ctx.data.userId, ctx.data.roomId),
		);
		revalidatePath(PATH);
		return actionOk();
	},
);

const giveCreditsSchema = z.object({
	userId: z.coerce.number().int().positive(),
	credits: z.coerce.number().int().positive(),
});

/** Give credits to a user (rcon: givecredits). */
export const giveCredits = adminAction(
	{ permission: PERMS.RCON_EXECUTE, schema: giveCreditsSchema },
	async (ctx) => {
		if (ctx.data.credits > MAX_CURRENCY) {
			throw new ActionError(`Amount is too large (max ${MAX_CURRENCY})`);
		}
		await requireRconOk(
			await rcon.giveCredits(ctx.data.userId, ctx.data.credits),
		);
		auditAction(Number(ctx.session.user.id), "give_credits", ctx.data.userId, {
			userId: ctx.data.userId,
			amount: ctx.data.credits,
		});
		revalidatePath(PATH);
		return actionOk();
	},
);

const giveAmountSchema = z.object({
	userId: z.coerce.number().int().positive(),
	amount: z.coerce.number().int().positive(),
});

/** Give duckets to a user (rcon: givepoints type=duckets). */
export const giveDuckets = adminAction(
	{ permission: PERMS.RCON_EXECUTE, schema: giveAmountSchema },
	async (ctx) => {
		if (ctx.data.amount > MAX_CURRENCY) {
			throw new ActionError(`Amount is too large (max ${MAX_CURRENCY})`);
		}
		await requireRconOk(
			await rcon.giveDuckets(ctx.data.userId, ctx.data.amount),
		);
		auditAction(Number(ctx.session.user.id), "give_duckets", ctx.data.userId, {
			userId: ctx.data.userId,
			amount: ctx.data.amount,
		});
		revalidatePath(PATH);
		return actionOk();
	},
);

/** Give diamonds to a user (rcon: givepoints type=diamonds). */
export const giveDiamonds = adminAction(
	{ permission: PERMS.RCON_EXECUTE, schema: giveAmountSchema },
	async (ctx) => {
		if (ctx.data.amount > MAX_CURRENCY) {
			throw new ActionError(`Amount is too large (max ${MAX_CURRENCY})`);
		}
		await requireRconOk(
			await rcon.giveDiamonds(ctx.data.userId, ctx.data.amount),
		);
		auditAction(Number(ctx.session.user.id), "give_diamonds", ctx.data.userId, {
			userId: ctx.data.userId,
			amount: ctx.data.amount,
		});
		revalidatePath(PATH);
		return actionOk();
	},
);

const giveBadgeSchema = z.object({
	userId: z.coerce.number().int().positive(),
	badge: z.string().trim().min(1).max(32),
});

/** Give a badge to a user (rcon: givebadge). */
export const giveBadge = adminAction(
	{ permission: PERMS.RCON_EXECUTE, schema: giveBadgeSchema },
	async (ctx) => {
		const badge = ctx.data.badge.normalize("NFC");
		await requireRconOk(await rcon.giveBadge(ctx.data.userId, badge));
		revalidatePath(PATH);
		return actionOk();
	},
);

const setMottoSchema = z.object({
	userId: z.coerce.number().int().positive(),
	motto: z.string().trim().min(1).max(127),
});

/** Set a user's motto (rcon: setmotto). */
export const setMotto = adminAction(
	{ permission: PERMS.RCON_EXECUTE, schema: setMottoSchema },
	async (ctx) => {
		const motto = ctx.data.motto.normalize("NFC");
		await requireRconOk(await rcon.setMotto(ctx.data.userId, motto));
		revalidatePath(PATH);
		return actionOk();
	},
);

const setRankSchema = z.object({
	userId: z.coerce.number().int().positive(),
	rank: z.coerce.number().int().min(1).max(9999),
});

/** Set a user's rank (rcon: setrank). */
export const setRank = adminAction(
	{ permission: PERMS.RCON_EXECUTE, schema: setRankSchema },
	async (ctx) => {
		const staffRank = Number(ctx.session.user.rank);
		const isSuper = ctx.permissions.isSuperAdmin;
		const [target] = await db
			.select({ rank: User.rank })
			.from(User)
			.where(eq(User.id, ctx.data.userId))
			.limit(1);
		if (!target) throw new ActionError("User not found");

		let rankExists: { id: number }[] = [];
		try {
			rankExists = await queryRows<{ id: number }>(
				sql`SELECT id FROM permission_ranks WHERE id = ${ctx.data.rank} LIMIT 1`,
			);
		} catch {
			rankExists = [];
		}
		if (rankExists.length === 0) throw new ActionError("Rank does not exist");

		if (!isSuper) {
			if (target.rank >= staffRank) {
				throw new ActionError(
					"Cannot change rank of a user at or above your rank",
				);
			}
			if (ctx.data.rank >= staffRank) {
				throw new ActionError("Cannot set a rank equal to or above your own");
			}
		}

		await requireRconOk(await rcon.setRank(ctx.data.userId, ctx.data.rank));
		await db
			.update(User)
			.set({ rank: ctx.data.rank })
			.where(eq(User.id, ctx.data.userId));
		revalidatePath(PATH);
		return actionOk();
	},
);

const executeCommandSchema = z.object({
	userId: z.coerce.number().int().positive(),
	command: z.string().trim().min(1).max(100),
});

/** Execute a command as a user (rcon: executecommand). */
export const executeCommand = adminAction(
	{ permission: PERMS.RCON_EXECUTE, schema: executeCommandSchema },
	async (ctx) => {
		const command = ctx.data.command.normalize("NFC");
		await requireRconOk(await rcon.executeCommand(ctx.data.userId, command));
		revalidatePath(PATH);
		return actionOk();
	},
);

const sendGiftSchema = z.object({
	userId: z.coerce.number().int().positive(),
	itemId: z.coerce.number().int().positive(),
	message: z.string().trim().max(255).optional().default("Here is a gift."),
});

/** Send a gift to a user (rcon: sendgift). */
export const sendGift = adminAction(
	{ permission: PERMS.RCON_EXECUTE, schema: sendGiftSchema },
	async (ctx) => {
		const message = ctx.data.message.trim().slice(0, 255) || "Here is a gift.";
		await requireRconOk(
			await rcon.sendGift(ctx.data.userId, ctx.data.itemId, message),
		);
		revalidatePath(PATH);
		return actionOk();
	},
);
