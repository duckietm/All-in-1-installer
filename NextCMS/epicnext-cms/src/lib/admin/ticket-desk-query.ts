import { and, eq, isNotNull, isNull, ne, type SQL, sql } from "drizzle-orm";
import { WebsiteTicket } from "@/lib/db";

/** Messages persist their staff role at send time; later rank changes do not alter the queue. */
export const latestTicketReplyIsStaff = sql<number>`COALESCE((SELECT m.is_staff FROM website_ticket_messages m WHERE m.ticket_id = ${WebsiteTicket.id} ORDER BY m.created_at DESC, m.id DESC LIMIT 1), 0)`;
export const latestTicketReplyAt = sql<string>`COALESCE((SELECT m.created_at FROM website_ticket_messages m WHERE m.ticket_id = ${WebsiteTicket.id} ORDER BY m.created_at DESC, m.id DESC LIMIT 1), ${WebsiteTicket.createdAt})`;
export const awaitingStaffCondition = and(
	ne(WebsiteTicket.status, "closed"),
	eq(latestTicketReplyIsStaff, 0),
);

export function ticketAssignmentCondition(
	value: string | undefined,
	userId: number,
): SQL | undefined {
	if (value === "mine") return eq(WebsiteTicket.assigneeId, userId);
	if (value === "unassigned") return isNull(WebsiteTicket.assigneeId);
	if (value === "assigned") return isNotNull(WebsiteTicket.assigneeId);
	return undefined;
}
