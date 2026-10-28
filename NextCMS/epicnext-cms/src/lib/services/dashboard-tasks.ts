import "server-only";
import { and, asc, count, eq, gt, sql } from "drizzle-orm";
import {
	db,
	MessengerFriendrequests,
	WebsiteEvent,
	WebsiteEventRegistration,
	WebsiteHelpCenterTicketReplies,
	WebsiteHelpCenterTickets,
} from "@/lib/db";

/** Caller supplies the authenticated session user, never a request parameter. */
export async function loadDashboardTasks(userId: number, now = new Date()) {
	if (!Number.isSafeInteger(userId) || userId <= 0)
		throw new Error("Invalid user");
	const [supportRows, friendRows, eventRows] = await Promise.all([
		db
			.select({ value: count() })
			.from(WebsiteHelpCenterTickets)
			.where(
				and(
					eq(WebsiteHelpCenterTickets.userId, userId),
					eq(WebsiteHelpCenterTickets.open, true),
					sql`(select ${WebsiteHelpCenterTicketReplies.userId} from ${WebsiteHelpCenterTicketReplies} where ${WebsiteHelpCenterTicketReplies.ticketId} = ${WebsiteHelpCenterTickets.id} order by ${WebsiteHelpCenterTicketReplies.id} desc limit 1) <> ${userId}`,
				),
			)
			.catch(() => null),
		db
			.select({ value: count() })
			.from(MessengerFriendrequests)
			.where(eq(MessengerFriendrequests.userToId, userId))
			.catch(() => null),
		db
			.select({
				id: WebsiteEvent.id,
				title: WebsiteEvent.title,
				startsAt: WebsiteEvent.startsAt,
			})
			.from(WebsiteEventRegistration)
			.innerJoin(
				WebsiteEvent,
				eq(WebsiteEvent.id, WebsiteEventRegistration.eventId),
			)
			.where(
				and(
					eq(WebsiteEventRegistration.userId, userId),
					eq(WebsiteEvent.status, "published"),
					gt(WebsiteEvent.startsAt, now),
				),
			)
			.orderBy(asc(WebsiteEvent.startsAt), asc(WebsiteEvent.id))
			.limit(1)
			.catch(() => null),
	]);
	return {
		support: supportRows === null ? null : Number(supportRows[0]?.value ?? 0),
		friendRequests:
			friendRows === null ? null : Number(friendRows[0]?.value ?? 0),
		registeredEvent: eventRows === null ? null : (eventRows[0] ?? false),
	};
}
