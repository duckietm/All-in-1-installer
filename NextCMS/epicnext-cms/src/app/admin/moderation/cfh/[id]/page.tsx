import { count, desc, eq, inArray } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { Ban, db, SupportTickets, User } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { CfhDetail } from "./cfh-detail";

export default async function CfhDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.MODERATION_VIEW, session.user.rank))
		redirect("/admin");

	const { id } = await params;
	const ticketId = Number(id);
	if (Number.isNaN(ticketId)) notFound();

	const [ticket] = await db
		.select()
		.from(SupportTickets)
		.where(eq(SupportTickets.id, ticketId))
		.limit(1);
	if (!ticket) notFound();

	const canEdit = canAccess(
		permissions,
		PERMS.MODERATION_EDIT,
		session.user.rank,
	);

	// Fetch sender, reported, mod info
	const userIds = [ticket.senderId, ticket.reportedId, ticket.modId].filter(
		Boolean,
	) as number[];
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

	// Get ban/mute history for reported user
	const reportedId = ticket.reportedId;
	const [banCountRows, recentBans] = reportedId
		? await Promise.all([
				db
					.select({ total: count() })
					.from(Ban)
					.where(eq(Ban.userId, reportedId)),
				db
					.select()
					.from(Ban)
					.where(eq(Ban.userId, reportedId))
					.orderBy(desc(Ban.id))
					.limit(5),
			])
		: [[{ total: 0 }], []];

	const banCount = Number(banCountRows[0]?.total ?? 0);

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
		/>
	);
}
