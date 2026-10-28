import "server-only";
import { and, asc, desc, eq, gt, inArray, ne } from "drizzle-orm";
import {
	db,
	MessengerFriendrequests,
	User,
	WebsiteEvent,
	WebsiteEventRegistration,
	WebsiteHelpCenterTicketReplies,
	WebsiteHelpCenterTickets,
} from "@/lib/db";
import { NotificationPreference, NotificationRead } from "./schema";
import {
	createNotificationService,
	type Notification,
	type NotificationRepository,
} from "./service";

// A bounded live inbox: up to 100 items per source, not an archival message store.
export const notificationRepository: NotificationRepository = {
	async source(userId) {
		const [support, friends, events] = await Promise.all([
			db
				.select({
					id: WebsiteHelpCenterTicketReplies.id,
					ticketId: WebsiteHelpCenterTickets.id,
					title: WebsiteHelpCenterTickets.title,
					createdAt: WebsiteHelpCenterTicketReplies.createdAt,
				})
				.from(WebsiteHelpCenterTicketReplies)
				.innerJoin(
					WebsiteHelpCenterTickets,
					eq(
						WebsiteHelpCenterTickets.id,
						WebsiteHelpCenterTicketReplies.ticketId,
					),
				)
				.where(
					and(
						eq(WebsiteHelpCenterTickets.userId, userId),
						ne(WebsiteHelpCenterTicketReplies.userId, userId),
					),
				)
				.orderBy(desc(WebsiteHelpCenterTicketReplies.id))
				.limit(100),
			db
				.select({ id: MessengerFriendrequests.id, username: User.username })
				.from(MessengerFriendrequests)
				.innerJoin(User, eq(User.id, MessengerFriendrequests.userFromId))
				.where(eq(MessengerFriendrequests.userToId, userId))
				.orderBy(desc(MessengerFriendrequests.id))
				.limit(100),
			db
				.select({
					id: WebsiteEvent.id,
					title: WebsiteEvent.title,
					startsAt: WebsiteEvent.startsAt,
					registrationId: WebsiteEventRegistration.id,
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
						gt(WebsiteEvent.startsAt, new Date()),
					),
				)
				.orderBy(asc(WebsiteEvent.startsAt), asc(WebsiteEvent.id))
				.limit(100),
		]);
		const items: Notification[] = [
			...support.map((row) => ({
				key: `support:${row.id}`,
				category: "support" as const,
				title: row.title,
				href: `/help/tickets/${row.ticketId}`,
				occurredAt: row.createdAt?.toISOString() ?? null,
			})),
			...friends.map((row) => ({
				key: `friends:${row.id}`,
				category: "friends" as const,
				title: row.username,
				href: "/friends",
				occurredAt: null,
			})),
			...events.map((row) => ({
				key: `events:${row.id}:${row.registrationId}:${row.startsAt.getTime()}`,
				category: "events" as const,
				title: row.title,
				href: `/events?mine=1`,
				occurredAt: row.startsAt.toISOString(),
			})),
		];
		return items;
	},
	async reads(userId, keys) {
		if (!keys.length) return [];
		return (
			await db
				.select({ key: NotificationRead.eventKey })
				.from(NotificationRead)
				.where(
					and(
						eq(NotificationRead.userId, userId),
						inArray(NotificationRead.eventKey, keys),
					),
				)
		).map((row) => row.key);
	},
	async mark(userId, key) {
		await db
			.insert(NotificationRead)
			.values({ userId, eventKey: key })
			.onDuplicateKeyUpdate({ set: { eventKey: key } });
	},
	async preferences(userId) {
		const [row] = await db
			.select({
				support: NotificationPreference.support,
				friends: NotificationPreference.friends,
				events: NotificationPreference.events,
			})
			.from(NotificationPreference)
			.where(eq(NotificationPreference.userId, userId))
			.limit(1);
		return row ?? { support: true, friends: true, events: true };
	},
	async savePreferences(userId, preferences) {
		await db
			.insert(NotificationPreference)
			.values({ userId, ...preferences })
			.onDuplicateKeyUpdate({ set: preferences });
	},
};
export const notifications = createNotificationService(notificationRepository);
