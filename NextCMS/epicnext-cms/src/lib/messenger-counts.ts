import { count, eq } from "drizzle-orm";
import { cache } from "react";
import { db, MessengerFriendrequests, MessengerOffline, User } from "@/lib/db";
import { logServerError } from "@/lib/server-log";

/**
 * The signed-in user's pending friend requests with who sent them, and the number of unread
 * offline messages. The top header and the navigation both show them: React's cache() runs the
 * queries once per request for both.
 */
export const loadMessengerCounts = cache(async (userId: number) => {
	const [requests, unreadRows] = await Promise.all([
		db
			.select({ id: User.id, username: User.username, look: User.look })
			.from(MessengerFriendrequests)
			.innerJoin(User, eq(User.id, MessengerFriendrequests.userFromId))
			.where(eq(MessengerFriendrequests.userToId, userId))
			.catch((error) => {
				logServerError("messenger_counts.requests_failed", error, { userId });
				return [] as { id: number; username: string; look: string }[];
			}),
		db
			.select({ total: count() })
			.from(MessengerOffline)
			.where(eq(MessengerOffline.userId, userId))
			.catch((error) => {
				logServerError("messenger_counts.unread_failed", error, { userId });
				return [] as { total: number }[];
			}),
	]);
	return { requests, unreadMessages: unreadRows[0]?.total ?? 0 };
});
