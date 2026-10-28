import { count, desc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { CfhDetail } from "@/app/admin/moderation/cfh/[id]/cfh-detail";
import { requireModPermission } from "@/lib/admin/guard";
import { Ban, db, SupportTickets, User } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function ModCfhDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	await requireModPermission([PERMS.MOD_CFH_VIEW, PERMS.MODERATION_VIEW]);

	const { session, permissions } = await getAdminContext();
	const { id } = await params;
	const ticketId = Number(id);
	if (Number.isNaN(ticketId)) notFound();

	const [ticket] = await db
		.select()
		.from(SupportTickets)
		.where(eq(SupportTickets.id, ticketId))
		.limit(1);
	if (!ticket) notFound();

	const canEdit =
		canAccess(permissions, PERMS.MOD_CFH_EDIT, session.user.rank) ||
		canAccess(permissions, PERMS.MODERATION_EDIT, session.user.rank);

	const userIds = [ticket.senderId, ticket.reportedId, ticket.modId].filter(
		Boolean,
	);
	const users =
		userIds.length > 0
			? await db
					.select({
						id: User.id,
						username: User.username,
						look: User.look,
						rank: User.rank,
						online: User.online,
						ipRegister: User.ipRegister,
						mail: User.mail,
					})
					.from(User)
					.where(inArray(User.id, userIds))
			: [];
	const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

	const reportedId = ticket.reportedId;
	let banCount = 0;
	let recentBans: {
		id: number;
		banReason: string;
		type: string;
		userStaffId: number;
		timestamp: number;
	}[] = [];
	if (reportedId) {
		const [countRows, bans] = await Promise.all([
			db.select({ total: count() }).from(Ban).where(eq(Ban.userId, reportedId)),
			db
				.select({
					id: Ban.id,
					banReason: Ban.banReason,
					type: Ban.type,
					userStaffId: Ban.userStaffId,
					timestamp: Ban.timestamp,
				})
				.from(Ban)
				.where(eq(Ban.userId, reportedId))
				.orderBy(desc(Ban.id))
				.limit(5),
		]);
		banCount = countRows[0]?.total ?? 0;
		recentBans = bans;
	}

	return (
		<CfhDetail
			ticket={{
				id: ticket.id,
				state: ticket.state,
				type: ticket.type,
				timestamp: ticket.timestamp,
				issue: ticket.issue,
				roomId: ticket.roomId,
				category: ticket.category,
				score: ticket.score,
			}}
			sender={userMap[ticket.senderId] ?? null}
			reported={userMap[ticket.reportedId] ?? null}
			moderator={userMap[ticket.modId] ?? null}
			banHistory={{
				count: banCount,
				recent: recentBans.map((b) => ({
					id: b.id,
					reason: b.banReason,
					type: b.type,
					staff: `Staff #${b.userStaffId}`,
					timestamp: b.timestamp,
				})),
			}}
			canEdit={canEdit}
			currentUserId={session.user.id}
			listHref="/mod/cfh"
			userLinkMode="public"
		/>
	);
}
