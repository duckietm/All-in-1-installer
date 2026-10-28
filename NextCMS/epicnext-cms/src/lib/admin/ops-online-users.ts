import { count, desc, eq } from "drizzle-orm";
import type { OnlineUser } from "@/components/admin/dashboard";
import { db, User } from "@/lib/db";

/** Shared online roster used by CommandoCentrum (and linked from other ops hubs). */
export async function fetchOpsOnlineUsers(
	limit = 40,
): Promise<{ count: number; users: OnlineUser[] }> {
	const [countRow, onlineUsersRaw] = await Promise.all([
		db
			.select({ total: count() })
			.from(User)
			.where(eq(User.online, "1"))
			.then((rows) => rows[0]?.total ?? 0)
			.catch(() => 0),
		db
			.select({
				id: User.id,
				username: User.username,
				look: User.look,
				lastOnline: User.lastOnline,
			})
			.from(User)
			.where(eq(User.online, "1"))
			.orderBy(desc(User.lastOnline))
			.limit(limit)
			.then((rows) => rows)
			.catch(
				() =>
					[] as Array<{
						id: number;
						username: string;
						look: string;
						lastOnline: number;
					}>,
			),
	]);

	const users: OnlineUser[] = onlineUsersRaw.map((u) => ({
		id: u.id,
		username: u.username,
		look: u.look,
		roomId: null,
		roomName: null,
		lastActivity: u.lastOnline > 0 ? new Date(u.lastOnline * 1000) : new Date(),
	}));

	return { count: countRow, users };
}
