// Public REST API — post a reply to a help-center ticket.
//
// Bearer-authed. POST inserts a reply ({ content }) authored by the current user
// into website_help_center_ticket_replies. The target ticket must exist and
// belong to the authed user. Fail-soft: never a 500.

import { eq } from "drizzle-orm";
import { apiError, apiJson, positiveBigInt } from "@/lib/api";
import { bearerUserId } from "@/lib/api-auth";
import {
	db,
	WebsiteHelpCenterTicketReplies,
	WebsiteHelpCenterTickets,
} from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { createOwnedTicketReply } from "@/lib/services/ticket-replies";

// POST /api/tickets/:id/reply  body: { content }
export async function POST(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const uid = await bearerUserId(req, ["tickets:write"]);
	if (!uid) return apiError("Unauthorized", 401);

	if (!(await rateLimit(`api-ticket-reply:${uid}`, 10, 60_000)).ok) {
		return apiError("Too many requests", 429);
	}

	const { id } = await params;
	const ticketId = positiveBigInt(id);
	if (!ticketId) return apiError("Invalid ticket id", 422);

	const body = (await req.json().catch(() => ({}))) as { content?: unknown };
	const content = String(body.content ?? "")
		.trim()
		.slice(0, 5000);
	if (!content) return apiError("Content is required");

	try {
		// Ownership check — only the ticket owner may reply.
		const reply = await db.transaction(async (tx) =>
			createOwnedTicketReply(
				{
					findTicket: async (id) => {
						const [row] = await tx
							.select({
								id: WebsiteHelpCenterTickets.id,
								userId: WebsiteHelpCenterTickets.userId,
							})
							.from(WebsiteHelpCenterTickets)
							.where(eq(WebsiteHelpCenterTickets.id, id))
							.limit(1);
						return row ?? null;
					},
					createReply: async (data) => {
						const [result] = await tx
							.insert(WebsiteHelpCenterTicketReplies)
							.values(data);
						return {
							id: BigInt(result.insertId),
							userId: data.userId,
							content: data.content,
							createdAt: data.createdAt,
						};
					},
					touchTicket: (id, updatedAt) =>
						tx
							.update(WebsiteHelpCenterTickets)
							.set({ updatedAt })
							.where(eq(WebsiteHelpCenterTickets.id, id)),
				},
				{ ticketId, userId: uid, content },
			),
		);
		if (!reply) return apiError("Ticket not found", 404);

		return apiJson(
			{
				reply: {
					id: reply.id,
					userId: reply.userId,
					content: reply.content,
					createdAt: reply.createdAt,
				},
			},
			{ status: 201 },
		);
	} catch {
		return apiError("Failed to post reply", 503);
	}
}
