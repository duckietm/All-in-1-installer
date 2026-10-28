"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { guardRank } from "@/lib/admin/rank-guard";
import { db, SupportTickets } from "@/lib/db";
import { actionOk, adminAction } from "@/lib/foundation/action";
import { NotFoundError } from "@/lib/foundation/errors";
import { PERMS } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import { rcon } from "@/lib/services/rcon";

// ── CFH Ticket Actions ──────────────────────────────────────────────

const cfhIdSchema = z.object({ ticketId: z.coerce.number().int().positive() });

const CFH_PERM = [PERMS.MODERATION_EDIT, PERMS.MOD_CFH_EDIT] as const;
const MOD_ACTION_PERM = [PERMS.MODERATION_EDIT, PERMS.MOD_ACTIONS] as const;

export const assignCfhTicket = adminAction(
	{ permission: CFH_PERM, schema: cfhIdSchema },
	async (ctx) => {
		const [ticket] = await db
			.select({ id: SupportTickets.id })
			.from(SupportTickets)
			.where(eq(SupportTickets.id, ctx.data.ticketId))
			.limit(1);
		if (!ticket) throw new NotFoundError("SupportTicket", ctx.data.ticketId);

		await db
			.update(SupportTickets)
			.set({ modId: ctx.session.user.id, state: 1 })
			.where(eq(SupportTickets.id, ctx.data.ticketId));

		logAudit({
			userId: ctx.session.user.id,
			action: "cfh_assign",
			target: "support_tickets",
			targetId: ctx.data.ticketId,
		});

		return actionOk();
	},
);

const cfhStateSchema = z.object({
	ticketId: z.coerce.number().int().positive(),
	state: z.coerce.number().int().min(0).max(3),
});

export const updateCfhState = adminAction(
	{ permission: CFH_PERM, schema: cfhStateSchema },
	async (ctx) => {
		const [ticket] = await db
			.select({
				id: SupportTickets.id,
				state: SupportTickets.state,
			})
			.from(SupportTickets)
			.where(eq(SupportTickets.id, ctx.data.ticketId))
			.limit(1);
		if (!ticket) throw new NotFoundError("SupportTicket", ctx.data.ticketId);

		await db
			.update(SupportTickets)
			.set({ state: ctx.data.state, modId: ctx.session.user.id })
			.where(eq(SupportTickets.id, ctx.data.ticketId));

		logAudit({
			userId: ctx.session.user.id,
			action: "cfh_state_change",
			target: "support_tickets",
			targetId: ctx.data.ticketId,
			before: { state: ticket.state },
			after: { state: ctx.data.state },
		});

		return actionOk();
	},
);

export const closeCfhTicket = adminAction(
	{ permission: CFH_PERM, schema: cfhIdSchema },
	async (ctx) => {
		await db
			.update(SupportTickets)
			.set({ state: 2, modId: ctx.session.user.id })
			.where(eq(SupportTickets.id, ctx.data.ticketId));

		logAudit({
			userId: ctx.session.user.id,
			action: "cfh_close",
			target: "support_tickets",
			targetId: ctx.data.ticketId,
		});

		return actionOk();
	},
);

// ── Quick Mod Actions ────────────────────────────────────────────────

const userIdSchema = z.object({ userId: z.coerce.number().int().positive() });

export const quickKick = adminAction(
	{ permission: MOD_ACTION_PERM, schema: userIdSchema },
	async (ctx) => {
		// Never on a user of the same or a higher rank (nor on yourself).
		await guardRank(ctx.data.userId, ctx.session.user.rank);
		await rcon.disconnectUser(ctx.data.userId);

		logAudit({
			userId: ctx.session.user.id,
			action: "mod_kick",
			target: "User",
			targetId: ctx.data.userId,
		});

		return actionOk();
	},
);

const muteSchema = z.object({
	userId: z.coerce.number().int().positive(),
	duration: z.coerce.number().int().min(0).max(525600),
});

export const quickMute = adminAction(
	{ permission: MOD_ACTION_PERM, schema: muteSchema },
	async (ctx) => {
		// Never on a user of the same or a higher rank (nor on yourself).
		await guardRank(ctx.data.userId, ctx.session.user.rank);
		await rcon.muteUser(ctx.data.userId, ctx.data.duration);

		logAudit({
			userId: ctx.session.user.id,
			action: "mod_mute",
			target: "User",
			targetId: ctx.data.userId,
			after: { duration: ctx.data.duration },
		});

		return actionOk();
	},
);

export const quickUnmute = adminAction(
	{ permission: MOD_ACTION_PERM, schema: userIdSchema },
	async (ctx) => {
		// Never on a user of the same or a higher rank (nor on yourself).
		await guardRank(ctx.data.userId, ctx.session.user.rank);
		await rcon.unmuteUser(ctx.data.userId);

		logAudit({
			userId: ctx.session.user.id,
			action: "mod_unmute",
			target: "User",
			targetId: ctx.data.userId,
		});

		return actionOk();
	},
);

const alertSchema = z.object({
	userId: z.coerce.number().int().positive(),
	message: z.string().min(1).max(500),
});

export const quickAlert = adminAction(
	{ permission: MOD_ACTION_PERM, schema: alertSchema },
	async (ctx) => {
		// Never on a user of the same or a higher rank (nor on yourself).
		await guardRank(ctx.data.userId, ctx.session.user.rank);
		await rcon.alertUser(ctx.data.userId, ctx.data.message);

		logAudit({
			userId: ctx.session.user.id,
			action: "mod_alert",
			target: "User",
			targetId: ctx.data.userId,
			after: { message: ctx.data.message },
		});

		return actionOk();
	},
);

const roomIdSchema = z.object({ roomId: z.coerce.number().int().positive() });

export const quickRoomKick = adminAction(
	{ permission: MOD_ACTION_PERM, schema: roomIdSchema },
	async (ctx) => {
		await rcon.kickAll(ctx.data.roomId);

		logAudit({
			userId: ctx.session.user.id,
			action: "mod_room_kick",
			target: "Room",
			targetId: ctx.data.roomId,
		});

		return actionOk();
	},
);

const broadcastSchema = z.object({
	message: z.string().min(1).max(500),
	type: z.enum(["hotel", "staff"]),
});

export const broadcastAlert = adminAction(
	{ permission: MOD_ACTION_PERM, schema: broadcastSchema },
	async (ctx) => {
		if (ctx.data.type === "hotel") {
			await rcon.hotelAlert(ctx.data.message);
		} else {
			await rcon.staffAlert(ctx.data.message);
		}

		logAudit({
			userId: ctx.session.user.id,
			action: `mod_broadcast_${ctx.data.type}`,
			target: "broadcast",
			after: { message: ctx.data.message },
		});

		return actionOk();
	},
);
