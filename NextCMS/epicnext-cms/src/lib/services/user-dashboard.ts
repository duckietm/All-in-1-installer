import { publicReadFailure } from "./public-read";
import "server-only";
import { and, asc, count, desc, eq, gt, inArray, or } from "drizzle-orm";
import {
	db,
	MessengerFriendships,
	MessengerOffline,
	Rooms,
	User,
	UserReferrals,
	UsersBadges,
	UsersCurrency,
	UsersSettings,
} from "@/lib/db";
import { resolveHotelName } from "@/lib/hotel-name";
import { loadDashboardEvent } from "./dashboard-event";
import { siteSettings } from "./site-settings";
export async function loadUserDashboard(userId: number) {
	const [
		dashboardEvent,
		userRows,
		hotelName,
		neededRaw,
		rewardAmountRaw,
		currencySettings,
		alertRaw,
		recentRooms,
		badges,
		userSettingsRows,
		unreadCountRows,
		referralsRows,
		friends,
		currencyRows,
	] = await Promise.all([
		loadDashboardEvent(),
		db
			.select({
				id: User.id,
				username: User.username,
				look: User.look,
				motto: User.motto,
				credits: User.credits,
				accountCreated: User.accountCreated,
				lastLogin: User.lastLogin,
				lastOnline: User.lastOnline,
			})
			.from(User)
			.where(eq(User.id, userId))
			.limit(1),
		resolveHotelName(),
		siteSettings.get("referrals_needed", "5"),
		siteSettings.get("referral_reward_amount", "30"),
		siteSettings.getMany([
			"referral_reward_currency_type",
			"referral_reward_currency",
		]),
		siteSettings.get("hotel_alert_banner", ""),
		db
			.select({
				id: Rooms.id,
				name: Rooms.name,
				ownerName: Rooms.ownerName,
				users: Rooms.users,
				usersMax: Rooms.usersMax,
			})
			.from(Rooms)
			.orderBy(desc(Rooms.id))
			.limit(6)
			.catch(publicReadFailure("dashboard.rooms")),
		db
			.select({
				badgeCode: UsersBadges.badgeCode,
				slotId: UsersBadges.slotId,
			})
			.from(UsersBadges)
			.where(and(eq(UsersBadges.userId, userId), gt(UsersBadges.slotId, 0)))
			.orderBy(asc(UsersBadges.slotId))
			.catch(publicReadFailure("dashboard.badges")),
		db
			.select({
				achievementScore: UsersSettings.achievementScore,
				respectsReceived: UsersSettings.respectsReceived,
			})
			.from(UsersSettings)
			.where(eq(UsersSettings.userId, userId))
			.limit(1)
			.catch(publicReadFailure("dashboard.settings")),
		db
			.select({ value: count() })
			.from(MessengerOffline)
			.where(eq(MessengerOffline.userId, userId))
			.catch(publicReadFailure("dashboard.unread")),
		db
			.select({ referralsTotal: UserReferrals.referralsTotal })
			.from(UserReferrals)
			.where(eq(UserReferrals.userId, userId))
			.orderBy(desc(UserReferrals.id))
			.limit(1)
			.catch(publicReadFailure("dashboard.referrals")),
		db
			.select({
				id: User.id,
				username: User.username,
				look: User.look,
				motto: User.motto,
				online: User.online,
			})
			.from(MessengerFriendships)
			.innerJoin(
				User,
				or(
					and(
						eq(MessengerFriendships.userOneId, userId),
						eq(User.id, MessengerFriendships.userTwoId),
					),
					and(
						eq(MessengerFriendships.userTwoId, userId),
						eq(User.id, MessengerFriendships.userOneId),
					),
				),
			)
			.where(
				or(
					eq(MessengerFriendships.userOneId, userId),
					eq(MessengerFriendships.userTwoId, userId),
				),
			)
			.catch(publicReadFailure("dashboard.friends")),
		db
			.select({ type: UsersCurrency.type, amount: UsersCurrency.amount })
			.from(UsersCurrency)
			.where(
				and(
					eq(UsersCurrency.userId, userId),
					inArray(UsersCurrency.type, [0, 5]),
				),
			)
			.catch(publicReadFailure("dashboard.currency")),
	]);

	// Each friendship can have two directional rows; expose users, not edges.
	const uniqueFriends = [
		...new Map(
			(friends ?? [])
				.filter((friend) => friend.id !== userId)
				.map((friend) => [friend.id, friend]),
		).values(),
	];

	return {
		dashboardEvent,
		userRows,
		hotelName,
		neededRaw,
		rewardAmountRaw,
		currencySettings,
		alertRaw,
		recentRooms,
		badges: badges ?? [],
		badgesUnavailable: badges === null,
		userSettingsRows: userSettingsRows ?? [],
		userSettingsUnavailable: userSettingsRows === null,
		friendsUnavailable: friends === null,
		friendCountRows: [{ value: uniqueFriends.length }],
		unreadCountRows,
		referralsRows,
		friends: uniqueFriends,
		currencyRows,
	};
}
