import { asc, count, desc, eq, or, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import {
	db,
	queryRows,
	Rooms,
	RoomTradeLog,
	User,
	UsersBadges,
	UsersCurrency,
} from "@/lib/db";

async function rawRows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
	return queryRows<T>(query);
}

export async function loadUserById(
	id: string,
	access: { logs: boolean; bans: boolean },
) {
	const numericId = Number(id);
	const isNumeric =
		Number.isSafeInteger(numericId) &&
		numericId > 0 &&
		String(numericId) === id;
	const [user] = await db
		.select({
			id: User.id,
			username: User.username,
			mail: User.mail,
			gender: User.gender,
			machineId: User.machineId,
			twoFactorConfirmedAt: User.twoFactorConfirmedAt,
			rank: User.rank,
			online: User.online,
			motto: User.motto,
			look: User.look,
			credits: User.credits,
			pixels: User.pixels,
			accountCreated: User.accountCreated,
			lastLogin: User.lastLogin,
			ipRegister: User.ipRegister,
			ipCurrent: User.ipCurrent,
		})
		.from(User)
		.where(isNumeric ? eq(User.id, numericId) : eq(User.username, id))
		.limit(1);
	if (!user) notFound();

	let activityUnavailable = false;
	const [
		currencies,
		badges,
		bansReceived,
		permissionRows,
		roomCountRows,
		tradeCountRows,
		userRooms,
		chatLogs,
		commandLogs,
	] = await Promise.all([
		db.select().from(UsersCurrency).where(eq(UsersCurrency.userId, user.id)),
		db
			.select({
				id: UsersBadges.id,
				badgeCode: UsersBadges.badgeCode,
			})
			.from(UsersBadges)
			.where(eq(UsersBadges.userId, user.id))
			.orderBy(asc(UsersBadges.slotId)),
		access.bans
			? rawRows<{
					id: number;
					banReason: string;
					type: string;
					timestamp: number;
					banExpire: number;
					staffName: string;
				}>(sql`
        SELECT b.id, b.ban_reason AS banReason, b.type, b.timestamp, b.ban_expire AS banExpire,
               COALESCE(s.username, 'Unknown') AS staffName
        FROM bans b LEFT JOIN users s ON s.id = b.user_staff_id
        WHERE b.user_id = ${user.id} ORDER BY b.id DESC LIMIT 5`).catch(
					() => [],
				)
			: [],
		rawRows<{ rankName: string }>(sql`
        SELECT COALESCE(rank_name, CONCAT('Rank ', id)) AS rankName FROM permissions WHERE id = ${user.rank} LIMIT 1`),
		db.select({ total: count() }).from(Rooms).where(eq(Rooms.ownerId, user.id)),
		access.logs
			? db
					.select({ total: count() })
					.from(RoomTradeLog)
					.where(
						or(
							eq(RoomTradeLog.userOneId, user.id),
							eq(RoomTradeLog.userTwoId, user.id),
						),
					)
					.catch(() => {
						activityUnavailable = true;
						return [];
					})
			: [],
		db
			.select({
				id: Rooms.id,
				name: Rooms.name,
				state: Rooms.state,
				users: Rooms.users,
				usersMax: Rooms.usersMax,
			})
			.from(Rooms)
			.where(eq(Rooms.ownerId, user.id))
			.orderBy(desc(Rooms.users))
			.limit(20),
		access.logs
			? rawRows<{
					id: number;
					roomId: number;
					timestamp: number;
					message: string;
				}>(sql`
        SELECT ROW_NUMBER() OVER (ORDER BY timestamp DESC) AS id, room_id AS roomId, timestamp, message
        FROM chatlogs_room WHERE user_from_id = ${user.id} ORDER BY timestamp DESC LIMIT 20`).catch(
					() => {
						activityUnavailable = true;
						return [];
					},
				)
			: [],
		access.logs
			? rawRows<{
					id: number;
					timestamp: number;
					command: string;
					params: string;
					succes: string;
				}>(sql`
        SELECT ROW_NUMBER() OVER (ORDER BY timestamp DESC) AS id, timestamp, command, params, succes
        FROM commandlogs WHERE user_id = ${user.id} ORDER BY timestamp DESC LIMIT 10`).catch(
					() => {
						activityUnavailable = true;
						return [];
					},
				)
			: [],
	]);

	const roomCount = Number(roomCountRows[0]?.total ?? 0);
	const tradeCount = Number(tradeCountRows[0]?.total ?? 0);

	const diamonds =
		currencies.find((currency) => currency.type === 5)?.amount ?? 0;
	const duckets =
		currencies.find((currency) => currency.type === 0)?.amount ?? 0;
	const now = Math.floor(Date.now() / 1000);
	const activeBan = bansReceived.find(
		(ban) => ban.banExpire === 0 || ban.banExpire > now,
	);
	const decoratedUser = {
		...user,
		mail: user.mail ?? "",
		gender: String(user.gender),
		machine_id: user.machineId,
		twoFactorConfirmed: user.twoFactorConfirmedAt ? 1 : 0,
		permission: {
			rankName: permissionRows[0]?.rankName ?? `Rank ${user.rank}`,
		},
		currencies,
		badges,
		bansReceived: bansReceived.map((ban) => ({
			...ban,
			staff: { username: ban.staffName },
		})),
	};

	return {
		user: decoratedUser,
		diamonds,
		duckets,
		roomCount,
		chatCount: chatLogs.length,
		tradeCount,
		userRooms,
		chatLogs,
		commandLogs,
		activityUnavailable,
		isOnline: user.online === "1",
		activeBan,
	};
}
