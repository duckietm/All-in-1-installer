import { asc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminHelpTicketDetail } from "@/app/admin/help-tickets/[id]/admin-help-ticket-detail";
import { TicketQueueBanner } from "@/components/admin/ticket-queue-banner";
import { requireModPermission } from "@/lib/admin/guard";
import { getMinStaffRank } from "@/lib/admin/min-staff-rank";
import { fetchTicketQueueOpenCounts } from "@/lib/admin/ticket-queue-counts";
import { positiveBigInt } from "@/lib/api";
import {
	db,
	User,
	WebsiteHelpCenterTicketReplies,
	WebsiteHelpCenterTickets,
} from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function ModHelpTicketDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	await requireModPermission([PERMS.MOD_TICKETS_VIEW, PERMS.TICKETS_VIEW]);

	const { session, permissions } = await getAdminContext();
	const { id } = await params;
	const ticketId = positiveBigInt(id);
	if (!ticketId) notFound();

	const [ticket] = await db
		.select({
			id: WebsiteHelpCenterTickets.id,
			userId: WebsiteHelpCenterTickets.userId,
			title: WebsiteHelpCenterTickets.title,
			content: WebsiteHelpCenterTickets.content,
			open: WebsiteHelpCenterTickets.open,
			createdAt: WebsiteHelpCenterTickets.createdAt,
			updatedAt: WebsiteHelpCenterTickets.updatedAt,
		})
		.from(WebsiteHelpCenterTickets)
		.where(eq(WebsiteHelpCenterTickets.id, ticketId))
		.limit(1);

	if (!ticket) notFound();

	const replies = await db
		.select({
			id: WebsiteHelpCenterTicketReplies.id,
			userId: WebsiteHelpCenterTicketReplies.userId,
			content: WebsiteHelpCenterTicketReplies.content,
			createdAt: WebsiteHelpCenterTicketReplies.createdAt,
		})
		.from(WebsiteHelpCenterTicketReplies)
		.where(eq(WebsiteHelpCenterTicketReplies.ticketId, ticket.id))
		.orderBy(asc(WebsiteHelpCenterTicketReplies.id));

	const authorIds = [
		...new Set([
			...(ticket.userId != null ? [ticket.userId] : []),
			...replies.map((r) => r.userId),
		]),
	];

	const users =
		authorIds.length > 0
			? await db
					.select({
						id: User.id,
						username: User.username,
						rank: User.rank,
						mail: User.mail,
					})
					.from(User)
					.where(inArray(User.id, authorIds))
			: [];

	const userById = new Map(users.map((u) => [u.id, u]));
	const openerId = ticket.userId;
	const minStaffRank = await getMinStaffRank();

	const messages = [
		{
			key: "opening",
			userId: openerId ?? 0,
			username:
				openerId != null
					? (userById.get(openerId)?.username ?? `#${openerId}`)
					: "—",
			isStaff: false,
			content: ticket.content,
			createdAt: (ticket.createdAt ?? new Date()).toISOString(),
		},
		...replies.map((r) => {
			const user = userById.get(r.userId);
			const isStaff =
				r.userId !== openerId && (user?.rank ?? 0) >= minStaffRank;
			return {
				key: String(r.id),
				userId: r.userId,
				username: user?.username ?? `#${r.userId}`,
				isStaff,
				content: r.content,
				createdAt: (r.createdAt ?? new Date()).toISOString(),
			};
		}),
	];

	const creator = openerId != null ? userById.get(openerId) : undefined;

	const canEdit =
		canAccess(permissions, PERMS.MOD_TICKETS_EDIT, session.user.rank) ||
		canAccess(permissions, PERMS.TICKETS_EDIT, session.user.rank);

	const t = await getTranslations("pages.admin.helpTickets");
	const queues = await fetchTicketQueueOpenCounts();

	return (
		<div className="space-y-6">
			<TicketQueueBanner
				hint={t("queueHint")}
				otherHref="/mod/tickets"
				otherLabel={t("queueOtherCta")}
				countsLine={t("queueCounts", {
					here: queues.helpOpen,
					other: queues.cmsOpen,
				})}
			/>
			<AdminHelpTicketDetail
				ticket={{
					id: String(ticket.id),
					title: ticket.title,
					open: ticket.open,
					createdAt: (ticket.createdAt ?? new Date()).toISOString(),
					updatedAt: (ticket.updatedAt ?? new Date()).toISOString(),
					creator: creator
						? {
								id: creator.id,
								username: creator.username,
								rank: creator.rank,
								mail: creator.mail ?? "",
							}
						: null,
				}}
				messages={messages}
				canEdit={canEdit}
				listHref="/mod/help-tickets"
				hideRequesterContact
			/>
		</div>
	);
}
