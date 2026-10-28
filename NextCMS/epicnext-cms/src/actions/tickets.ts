"use server";

import { eq } from "drizzle-orm";
import { db, WebsiteTicket, WebsiteTicketMessage } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { adminAction } from "@/lib/safe-action";
import { ActionError, actionOk } from "@/lib/safe-action-shared";
import { logAudit } from "@/lib/services/audit";
import {
	assignTicketSchema,
	replyTicketSchema,
	updateTicketPrioritySchema,
	updateTicketStatusSchema,
} from "@/lib/validators/ticket";

// ── User actions (authenticated, no admin perms needed) ──────────────

export const adminReplyTicket = adminAction(
	{
		permission: [PERMS.TICKETS_EDIT, PERMS.MOD_TICKETS_EDIT],
		schema: replyTicketSchema,
	},
	async (ctx) => {
		const [ticket] = await db
			.select({
				id: WebsiteTicket.id,
				assigneeId: WebsiteTicket.assigneeId,
			})
			.from(WebsiteTicket)
			.where(eq(WebsiteTicket.id, ctx.data.ticketId))
			.limit(1);

		if (!ticket) throw new ActionError("Ticket not found");

		await db.insert(WebsiteTicketMessage).values({
			ticketId: ctx.data.ticketId,
			userId: ctx.session.user.id,
			message: ctx.data.message,
			isStaff: 1,
		});

		// Auto-assign if not assigned yet
		const updates: Partial<typeof WebsiteTicket.$inferInsert> = {
			status: "waiting",
			updatedAt: new Date(),
		};
		if (!ticket.assigneeId) {
			updates.assigneeId = ctx.session.user.id;
		}

		await db
			.update(WebsiteTicket)
			.set(updates)
			.where(eq(WebsiteTicket.id, ctx.data.ticketId));

		logAudit({
			userId: ctx.session.user.id,
			action: "ticket_reply",
			target: "WebsiteTicket",
			targetId: ctx.data.ticketId,
		});

		return actionOk();
	},
);

export const updateTicketStatus = adminAction(
	{
		permission: [PERMS.TICKETS_EDIT, PERMS.MOD_TICKETS_EDIT],
		schema: updateTicketStatusSchema,
	},
	async (ctx) => {
		const [ticket] = await db
			.select({
				id: WebsiteTicket.id,
				assigneeId: WebsiteTicket.assigneeId,
				status: WebsiteTicket.status,
			})
			.from(WebsiteTicket)
			.where(eq(WebsiteTicket.id, ctx.data.ticketId))
			.limit(1);

		if (!ticket) throw new ActionError("Ticket not found");

		const data: Partial<typeof WebsiteTicket.$inferInsert> = {
			status: ctx.data.status,
			updatedAt: new Date(),
		};
		if (ctx.data.status === "closed") {
			data.closedAt = new Date();
		}
		if (ctx.data.status === "in_progress" && !ticket.assigneeId) {
			data.assigneeId = ctx.session.user.id;
		}

		await db
			.update(WebsiteTicket)
			.set(data)
			.where(eq(WebsiteTicket.id, ctx.data.ticketId));

		logAudit({
			userId: ctx.session.user.id,
			action: "ticket_status_change",
			target: "WebsiteTicket",
			targetId: ctx.data.ticketId,
			before: { status: ticket.status },
			after: { status: ctx.data.status },
		});

		return actionOk();
	},
);

export const assignTicket = adminAction(
	{
		permission: [PERMS.TICKETS_EDIT, PERMS.MOD_TICKETS_EDIT],
		schema: assignTicketSchema,
	},
	async (ctx) => {
		const [ticket] = await db
			.select({
				id: WebsiteTicket.id,
				assigneeId: WebsiteTicket.assigneeId,
			})
			.from(WebsiteTicket)
			.where(eq(WebsiteTicket.id, ctx.data.ticketId))
			.limit(1);

		if (!ticket) throw new ActionError("Ticket not found");

		await db
			.update(WebsiteTicket)
			.set({
				assigneeId: ctx.data.assigneeId,
				status: ctx.data.assigneeId ? "in_progress" : "open",
				updatedAt: new Date(),
			})
			.where(eq(WebsiteTicket.id, ctx.data.ticketId));

		logAudit({
			userId: ctx.session.user.id,
			action: "ticket_assign",
			target: "WebsiteTicket",
			targetId: ctx.data.ticketId,
			before: { assigneeId: ticket.assigneeId },
			after: { assigneeId: ctx.data.assigneeId },
		});

		return actionOk();
	},
);

export const updateTicketPriority = adminAction(
	{
		permission: [PERMS.TICKETS_EDIT, PERMS.MOD_TICKETS_EDIT],
		schema: updateTicketPrioritySchema,
	},
	async (ctx) => {
		const [ticket] = await db
			.select({
				id: WebsiteTicket.id,
				priority: WebsiteTicket.priority,
			})
			.from(WebsiteTicket)
			.where(eq(WebsiteTicket.id, ctx.data.ticketId))
			.limit(1);

		if (!ticket) throw new ActionError("Ticket not found");

		await db
			.update(WebsiteTicket)
			.set({ priority: ctx.data.priority, updatedAt: new Date() })
			.where(eq(WebsiteTicket.id, ctx.data.ticketId));

		logAudit({
			userId: ctx.session.user.id,
			action: "ticket_priority_change",
			target: "WebsiteTicket",
			targetId: ctx.data.ticketId,
			before: { priority: ticket.priority },
			after: { priority: ctx.data.priority },
		});

		return actionOk();
	},
);
