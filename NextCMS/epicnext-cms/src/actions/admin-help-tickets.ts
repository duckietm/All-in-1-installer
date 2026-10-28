"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	Ban,
	db,
	WebsiteHelpCenterTicketReplies,
	WebsiteHelpCenterTickets,
} from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { adminAction } from "@/lib/safe-action";
import { ActionError, actionOk } from "@/lib/safe-action-shared";
import { logAudit } from "@/lib/services/audit";

const ticketIdField = z
	.union([z.string(), z.number(), z.bigint()])
	.transform((v) => BigInt(String(v)));

const replyHelpCenterTicketSchema = z.object({
	ticketId: ticketIdField,
	content: z.string().min(1).max(5000),
});

const helpCenterTicketIdSchema = z.object({
	ticketId: ticketIdField,
});

function revalidateHelpCenterTicketPaths(ticketId: bigint) {
	const id = String(ticketId);
	revalidatePath("/admin/help-tickets");
	revalidatePath(`/admin/help-tickets/${id}`);
	revalidatePath("/mod/help-tickets");
	revalidatePath(`/mod/help-tickets/${id}`);
	revalidatePath("/help/tickets");
	revalidatePath(`/help/tickets/${id}`);
}

export const liftBanFromHelpTicket = adminAction(
	{
		permission: PERMS.USERS_BAN,
		schema: helpCenterTicketIdSchema,
	},
	async (ctx) => {
		const ticketId = ctx.data.ticketId;
		const [ticket] = await db
			.select({
				id: WebsiteHelpCenterTickets.id,
				userId: WebsiteHelpCenterTickets.userId,
				open: WebsiteHelpCenterTickets.open,
				title: WebsiteHelpCenterTickets.title,
			})
			.from(WebsiteHelpCenterTickets)
			.where(eq(WebsiteHelpCenterTickets.id, ticketId))
			.limit(1);
		if (!ticket) throw new ActionError("Ticket not found");
		if (ticket.userId == null) {
			throw new ActionError("Ticket has no requester to unban");
		}

		const result = await db.delete(Ban).where(eq(Ban.userId, ticket.userId));
		const removed = Number(result[0]?.affectedRows ?? 0);

		const now = new Date();
		if (ticket.open) {
			await db
				.update(WebsiteHelpCenterTickets)
				.set({ open: false, updatedAt: now })
				.where(eq(WebsiteHelpCenterTickets.id, ticketId));
		}

		await logAudit({
			userId: ctx.session.user.id,
			action: "unban_via_help_ticket",
			target: "User",
			targetId: ticket.userId,
			after: {
				ticketId: String(ticketId),
				removedBans: removed,
				title: ticket.title,
			},
		});

		revalidateHelpCenterTicketPaths(ticketId);
		revalidatePath("/admin/bans");
		revalidatePath(`/admin/users/show/${ticket.userId}`);
		return actionOk({ removed, userId: ticket.userId });
	},
);

const HELP_TICKET_EDIT = [PERMS.TICKETS_EDIT, PERMS.MOD_TICKETS_EDIT] as const;

export const replyHelpCenterTicket = adminAction(
	{ permission: HELP_TICKET_EDIT, schema: replyHelpCenterTicketSchema },
	async (ctx) => {
		const ticketId = ctx.data.ticketId;
		const [ticket] = await db
			.select({
				id: WebsiteHelpCenterTickets.id,
				open: WebsiteHelpCenterTickets.open,
			})
			.from(WebsiteHelpCenterTickets)
			.where(eq(WebsiteHelpCenterTickets.id, ticketId))
			.limit(1);

		if (!ticket) throw new ActionError("Ticket not found");

		const now = new Date();
		const staffId = Number(ctx.session.user.id);

		await db.transaction(async (tx) => {
			await tx.insert(WebsiteHelpCenterTicketReplies).values({
				ticketId,
				userId: staffId,
				content: ctx.data.content.trim(),
				createdAt: now,
				updatedAt: now,
			});
			await tx
				.update(WebsiteHelpCenterTickets)
				.set({ updatedAt: now })
				.where(eq(WebsiteHelpCenterTickets.id, ticketId));
		});

		await logAudit({
			userId: staffId,
			action: "help_center_ticket_reply",
			target: "WebsiteHelpCenterTickets",
			targetId: Number(ticketId),
		});

		revalidateHelpCenterTicketPaths(ticketId);
		return actionOk();
	},
);

export const closeHelpCenterTicket = adminAction(
	{ permission: HELP_TICKET_EDIT, schema: helpCenterTicketIdSchema },
	async (ctx) => {
		const ticketId = ctx.data.ticketId;
		const [ticket] = await db
			.select({
				id: WebsiteHelpCenterTickets.id,
				open: WebsiteHelpCenterTickets.open,
			})
			.from(WebsiteHelpCenterTickets)
			.where(eq(WebsiteHelpCenterTickets.id, ticketId))
			.limit(1);

		if (!ticket) throw new ActionError("Ticket not found");
		if (!ticket.open) throw new ActionError("Ticket is already closed");

		const now = new Date();
		await db
			.update(WebsiteHelpCenterTickets)
			.set({ open: false, updatedAt: now })
			.where(eq(WebsiteHelpCenterTickets.id, ticketId));

		await logAudit({
			userId: Number(ctx.session.user.id),
			action: "help_center_ticket_close",
			target: "WebsiteHelpCenterTickets",
			targetId: Number(ticketId),
			before: { open: true },
			after: { open: false },
		});

		revalidateHelpCenterTicketPaths(ticketId);
		return actionOk();
	},
);

export const reopenHelpCenterTicket = adminAction(
	{ permission: HELP_TICKET_EDIT, schema: helpCenterTicketIdSchema },
	async (ctx) => {
		const ticketId = ctx.data.ticketId;
		const [ticket] = await db
			.select({
				id: WebsiteHelpCenterTickets.id,
				open: WebsiteHelpCenterTickets.open,
			})
			.from(WebsiteHelpCenterTickets)
			.where(eq(WebsiteHelpCenterTickets.id, ticketId))
			.limit(1);

		if (!ticket) throw new ActionError("Ticket not found");
		if (ticket.open) throw new ActionError("Ticket is already open");

		const now = new Date();
		await db
			.update(WebsiteHelpCenterTickets)
			.set({ open: true, updatedAt: now })
			.where(eq(WebsiteHelpCenterTickets.id, ticketId));

		await logAudit({
			userId: Number(ctx.session.user.id),
			action: "help_center_ticket_reopen",
			target: "WebsiteHelpCenterTickets",
			targetId: Number(ticketId),
			before: { open: false },
			after: { open: true },
		});

		revalidateHelpCenterTicketPaths(ticketId);
		return actionOk();
	},
);
