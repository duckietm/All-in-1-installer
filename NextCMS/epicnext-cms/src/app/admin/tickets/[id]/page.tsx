import { asc, eq, gte } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { TicketQueueBanner } from "@/components/admin/ticket-queue-banner";
import { getMinStaffRank } from "@/lib/admin/min-staff-rank";
import { fetchTicketQueueOpenCounts } from "@/lib/admin/ticket-queue-counts";
import { db, User, WebsiteTicket } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { AdminTicketDetail } from "./admin-ticket-detail";

export default async function AdminTicketDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.TICKETS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.tickets");
	const { id } = await params;
	const ticketId = Number(id);
	if (Number.isNaN(ticketId)) notFound();

	const ticket = await db.query.WebsiteTicket.findFirst({
		where: eq(WebsiteTicket.id, ticketId),
		with: {
			creator: {
				columns: {
					id: true,
					username: true,
					look: true,
					rank: true,
					ipRegister: true,
					mail: true,
					accountCreated: true,
				},
			},
			assignee: { columns: { id: true, username: true } },
			messages: {
				orderBy: (m, { asc: a }) => [a(m.createdAt)],
				with: {
					user: {
						columns: { id: true, username: true, look: true, rank: true },
					},
				},
			},
		},
	});

	if (!ticket) notFound();

	// Staff assignees: min_staff_rank and above
	const minStaffRank = await getMinStaffRank();
	const staffMembers = await db
		.select({ id: User.id, username: User.username })
		.from(User)
		.where(gte(User.rank, minStaffRank))
		.orderBy(asc(User.username));

	const canEdit = canAccess(permissions, PERMS.TICKETS_EDIT, session.user.rank);
	const queues = await fetchTicketQueueOpenCounts();

	return (
		<div className="space-y-6">
			<TicketQueueBanner
				hint={t("queueHint")}
				otherHref="/admin/help-tickets"
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
						id: ticket.creator.id,
						username: ticket.creator.username,
						look: ticket.creator.look,
						rank: ticket.creator.rank,
						mail: ticket.creator.mail ?? "",
						ipRegister: ticket.creator.ipRegister,
						accountCreated: ticket.creator.accountCreated,
					},
					assignee: ticket.assignee
						? { id: ticket.assignee.id, username: ticket.assignee.username }
						: null,
				}}
				messages={ticket.messages.map((m) => ({
					id: m.id,
					message: m.message,
					isStaff: m.isStaff === 1,
					createdAt: m.createdAt.toISOString(),
					user: {
						id: m.user.id,
						username: m.user.username,
						look: m.user.look,
						rank: m.user.rank,
					},
				}))}
				staffMembers={staffMembers}
				currentUserId={session.user.id}
				canEdit={canEdit}
			/>
		</div>
	);
}
