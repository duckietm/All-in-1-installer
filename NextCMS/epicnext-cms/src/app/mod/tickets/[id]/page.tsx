import { asc, eq, gte } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminTicketDetail } from "@/app/admin/tickets/[id]/admin-ticket-detail";
import { TicketQueueBanner } from "@/components/admin/ticket-queue-banner";
import { requireModPermission } from "@/lib/admin/guard";
import { getMinStaffRank } from "@/lib/admin/min-staff-rank";
import { fetchTicketQueueOpenCounts } from "@/lib/admin/ticket-queue-counts";
import { db, User, WebsiteTicket, WebsiteTicketMessage } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

const Creator = alias(User, "ticket_creator");
const Assignee = alias(User, "ticket_assignee");
const MessageUser = alias(User, "ticket_message_user");

export default async function ModTicketDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	await requireModPermission([PERMS.MOD_TICKETS_VIEW, PERMS.TICKETS_VIEW]);

	const { session, permissions } = await getAdminContext();
	const { id } = await params;
	const ticketId = Number(id);
	if (Number.isNaN(ticketId)) notFound();

	const [ticket] = await db
		.select({
			id: WebsiteTicket.id,
			subject: WebsiteTicket.subject,
			category: WebsiteTicket.category,
			priority: WebsiteTicket.priority,
			status: WebsiteTicket.status,
			createdAt: WebsiteTicket.createdAt,
			closedAt: WebsiteTicket.closedAt,
			creatorId: Creator.id,
			creatorUsername: Creator.username,
			creatorLook: Creator.look,
			creatorRank: Creator.rank,
			creatorIpRegister: Creator.ipRegister,
			creatorMail: Creator.mail,
			creatorAccountCreated: Creator.accountCreated,
			assigneeId: Assignee.id,
			assigneeUsername: Assignee.username,
		})
		.from(WebsiteTicket)
		.innerJoin(Creator, eq(WebsiteTicket.creatorId, Creator.id))
		.leftJoin(Assignee, eq(WebsiteTicket.assigneeId, Assignee.id))
		.where(eq(WebsiteTicket.id, ticketId))
		.limit(1);

	if (!ticket) notFound();

	const messages = await db
		.select({
			id: WebsiteTicketMessage.id,
			message: WebsiteTicketMessage.message,
			isStaff: WebsiteTicketMessage.isStaff,
			createdAt: WebsiteTicketMessage.createdAt,
			userId: MessageUser.id,
			username: MessageUser.username,
			look: MessageUser.look,
			rank: MessageUser.rank,
		})
		.from(WebsiteTicketMessage)
		.innerJoin(MessageUser, eq(WebsiteTicketMessage.userId, MessageUser.id))
		.where(eq(WebsiteTicketMessage.ticketId, ticketId))
		.orderBy(asc(WebsiteTicketMessage.createdAt));

	const minStaffRank = await getMinStaffRank();
	const staffMembers = await db
		.select({ id: User.id, username: User.username })
		.from(User)
		.where(gte(User.rank, minStaffRank))
		.orderBy(asc(User.username));

	const canEdit =
		canAccess(permissions, PERMS.MOD_TICKETS_EDIT, session.user.rank) ||
		canAccess(permissions, PERMS.TICKETS_EDIT, session.user.rank);

	const t = await getTranslations("pages.admin.tickets");
	const queues = await fetchTicketQueueOpenCounts();

	return (
		<div className="space-y-6">
			<TicketQueueBanner
				hint={t("queueHint")}
				otherHref="/mod/help-tickets"
				otherLabel={t("queueOtherCta")}
				countsLine={t("queueCounts", {
					here: queues.cmsOpen,
					other: queues.helpOpen,
				})}
			/>
			<AdminTicketDetail
				ticket={{
					id: ticket.id,
					subject: ticket.subject,
					category: ticket.category,
					priority: ticket.priority,
					status: ticket.status,
					createdAt: ticket.createdAt.toISOString(),
					closedAt: ticket.closedAt?.toISOString() ?? null,
					creator: {
						id: ticket.creatorId,
						username: ticket.creatorUsername,
						look: ticket.creatorLook,
						rank: ticket.creatorRank,
						mail: ticket.creatorMail ?? "",
						ipRegister: ticket.creatorIpRegister,
						accountCreated: ticket.creatorAccountCreated,
					},
					assignee:
						ticket.assigneeId != null && ticket.assigneeUsername
							? { id: ticket.assigneeId, username: ticket.assigneeUsername }
							: null,
				}}
				messages={messages.map((m) => ({
					id: m.id,
					message: m.message,
					isStaff: m.isStaff === 1,
					createdAt: m.createdAt.toISOString(),
					user: {
						id: m.userId,
						username: m.username,
						look: m.look,
						rank: m.rank,
					},
				}))}
				staffMembers={staffMembers}
				currentUserId={session.user.id}
				canEdit={canEdit}
				listHref="/mod/tickets"
				userLinkMode="public"
			/>
		</div>
	);
}
