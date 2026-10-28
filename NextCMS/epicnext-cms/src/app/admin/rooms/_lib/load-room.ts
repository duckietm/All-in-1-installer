import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, Rooms, User } from "@/lib/db";

export async function loadRoom(id: string) {
	const roomId = parseInt(id, 10);
	if (Number.isNaN(roomId)) notFound();

	const [room] = await db
		.select({
			id: Rooms.id,
			ownerId: Rooms.ownerId,
			ownerName: Rooms.ownerName,
			name: Rooms.name,
			description: Rooms.description,
			state: Rooms.state,
			users: Rooms.users,
			usersMax: Rooms.usersMax,
			category: Rooms.category,
			score: Rooms.score,
		})
		.from(Rooms)
		.where(eq(Rooms.id, roomId))
		.limit(1);

	if (!room) notFound();
	const owner =
		room.ownerId > 0
			? ((
					await db
						.select({
							id: User.id,
							username: User.username,
							look: User.look,
						})
						.from(User)
						.where(eq(User.id, room.ownerId))
						.limit(1)
				)[0] ?? null)
			: null;
	return { ...room, owner };
}
