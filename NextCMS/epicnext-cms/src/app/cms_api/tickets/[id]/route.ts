// Public REST API — a single help-center ticket (with replies).
//
// Bearer-authed. GET returns one ticket that MUST belong to the authed user,
// together with its replies; reply author usernames are resolved in a single
// users lookup. Fail-soft: never a 500.

import { asc, eq, inArray } from "drizzle-orm";
import { apiError, apiJson, positiveBigInt } from "@/lib/api";
import { bearerUserId } from "@/lib/api-auth";
import {
	db,
	User,
	WebsiteHelpCenterTicketReplies,
	WebsiteHelpCenterTickets,
} from "@/lib/db";

// GET /cms_api/tickets/:id
export async function GET(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const uid = await bearerUserId(req, ["tickets:read"]);
	if (!uid) return apiError("Unauthorized", 401);

	const { id } = await params;
	const ticketId = positiveBigInt(id);
	if (!ticketId) return apiError("Invalid ticket id", 422);

	try {
		const [ticket] = await db
			.select({
				id: WebsiteHelpCenterTickets.id,
				userId: WebsiteHelpCenterTickets.userId,
				categoryId: WebsiteHelpCenterTickets.categoryId,
				title: WebsiteHelpCenterTickets.title,
				content: WebsiteHelpCenterTickets.content,
				open: WebsiteHelpCenterTickets.open,
				createdAt: WebsiteHelpCenterTickets.createdAt,
			})
			.from(WebsiteHelpCenterTickets)
			.where(eq(WebsiteHelpCenterTickets.id, ticketId))
			.limit(1);

		// Ownership check — return 404 (not 403) so a foreign id is indistinguishable
		// from a missing one.
		if (!ticket || ticket.userId !== uid)
			return apiError("Ticket not found", 404);

		const replies = await db
			.select({
				id: WebsiteHelpCenterTicketReplies.id,
				userId: WebsiteHelpCenterTicketReplies.userId,
				content: WebsiteHelpCenterTicketReplies.content,
				createdAt: WebsiteHelpCenterTicketReplies.createdAt,
			})
			.from(WebsiteHelpCenterTicketReplies)
			.where(eq(WebsiteHelpCenterTicketReplies.ticketId, ticketId))
			.orderBy(asc(WebsiteHelpCenterTicketReplies.id));

		// Resolve author usernames in one query.
		const authorIds = [...new Set(replies.map((r) => r.userId))];
		const authors = authorIds.length
			? await db
					.select({ id: User.id, username: User.username })
					.from(User)
					.where(inArray(User.id, authorIds))
			: [];
		const nameById = new Map(authors.map((a) => [a.id, a.username]));

		return apiJson({
			ticket: {
				id: ticket.id,
				categoryId: ticket.categoryId,
				title: ticket.title,
				content: ticket.content,
				open: ticket.open,
				createdAt: ticket.createdAt,
				replies: replies.map((r) => ({
					id: r.id,
					userId: r.userId,
					username: nameById.get(r.userId) ?? null,
					content: r.content,
					createdAt: r.createdAt,
				})),
			},
		});
	} catch {
		return apiError("Failed to load ticket", 503);
	}
}
