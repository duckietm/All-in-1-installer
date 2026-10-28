import {
	and,
	asc,
	count,
	desc,
	eq,
	like,
	ne,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { StatusCard } from "@/components/admin/dashboard";
import { TicketQueueBanner } from "@/components/admin/ticket-queue-banner";
import {
	awaitingStaffCondition,
	latestTicketReplyAt,
	latestTicketReplyIsStaff,
	ticketAssignmentCondition,
} from "@/lib/admin/ticket-desk-query";
import { fetchTicketQueueOpenCounts } from "@/lib/admin/ticket-queue-counts";
import { ticketReplyAge } from "@/lib/admin/ticket-reply-age";
import { calcPagination, parseListParams } from "@/lib/admin-helpers";
import { db, User, WebsiteTicket } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { type TicketRow, TicketsTable } from "../tickets-table";

export default async function AdminTicketsDeskPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.TICKETS_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.tickets");
	const raw = await searchParams;
	const parsed = parseListParams(new URLSearchParams(raw));
	const statusFilter = raw.filter_status || raw.status || "active";

	const Creator = alias(User, "ticket_creator");
	const Assignee = alias(User, "ticket_assignee");

	const conditions: SQL[] = [];
	const assignment = ticketAssignmentCondition(
		raw.filter_assignee,
		session.user.id,
	);
	if (assignment) conditions.push(assignment);

	if (statusFilter === "awaiting_staff") {
		if (awaitingStaffCondition) conditions.push(awaitingStaffCondition);
	} else if (statusFilter === "active") {
		conditions.push(ne(WebsiteTicket.status, "closed"));
	} else if (statusFilter && statusFilter !== "all") {
		conditions.push(eq(WebsiteTicket.status, statusFilter));
	}

	if (parsed.search.trim()) {
		const q = parsed.search.trim();
		const asId = Number(q);
		const searchFilter = or(
			like(WebsiteTicket.subject, `%${q}%`),
			like(WebsiteTicket.category, `%${q}%`),
			like(Creator.username, `%${q}%`),
			like(Assignee.username, `%${q}%`),
			...(Number.isFinite(asId) && asId > 0
				? [eq(WebsiteTicket.id, asId)]
				: []),
		);
		if (searchFilter) conditions.push(searchFilter);
	}

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const orderCol =
		parsed.sort === "subject"
			? WebsiteTicket.subject
			: parsed.sort === "status"
				? WebsiteTicket.status
				: parsed.sort === "priority"
					? WebsiteTicket.priority
					: parsed.sort === "assignee"
						? WebsiteTicket.assigneeId
						: parsed.sort === "id"
							? WebsiteTicket.id
							: WebsiteTicket.createdAt;
	const orderBy = parsed.order === "asc" ? asc(orderCol) : desc(orderCol);

	const [totalRows, openRows, inProgressRows, waitingRows, closedRows, queues] =
		await Promise.all([
			db
				.select({ total: count() })
				.from(WebsiteTicket)
				.leftJoin(Creator, eq(WebsiteTicket.creatorId, Creator.id))
				.leftJoin(Assignee, eq(WebsiteTicket.assigneeId, Assignee.id))
				.where(where)
				.catch(() => [{ total: 0 }]),
			db
				.select({ total: count() })
				.from(WebsiteTicket)
				.where(eq(WebsiteTicket.status, "open"))
				.catch(() => [{ total: 0 }]),
			db
				.select({ total: count() })
				.from(WebsiteTicket)
				.where(eq(WebsiteTicket.status, "in_progress"))
				.catch(() => [{ total: 0 }]),
			db
				.select({ total: count() })
				.from(WebsiteTicket)
				.where(eq(WebsiteTicket.status, "waiting"))
				.catch(() => [{ total: 0 }]),
			db
				.select({ total: count() })
				.from(WebsiteTicket)
				.where(eq(WebsiteTicket.status, "closed"))
				.catch(() => [{ total: 0 }]),
			fetchTicketQueueOpenCounts(),
		]);

	const total = Number(totalRows[0]?.total ?? 0);
	const openCount = Number(openRows[0]?.total ?? 0);
	const inProgressCount = Number(inProgressRows[0]?.total ?? 0);
	const waitingCount = Number(waitingRows[0]?.total ?? 0);
	const closedCount = Number(closedRows[0]?.total ?? 0);

	const pagination = calcPagination(total, parsed.page, parsed.perPage);

	const tickets = await db
		.select({
			id: WebsiteTicket.id,
			subject: WebsiteTicket.subject,
			creatorId: WebsiteTicket.creatorId,
			category: WebsiteTicket.category,
			status: WebsiteTicket.status,
			priority: WebsiteTicket.priority,
			createdAt: WebsiteTicket.createdAt,
			creatorUsername: Creator.username,
			assigneeUsername: Assignee.username,
			replyAt: latestTicketReplyAt,
			replyIsStaff: latestTicketReplyIsStaff,
			messageCount: sql<number>`(
				SELECT COUNT(*) FROM website_ticket_messages m
				WHERE m.ticket_id = ${WebsiteTicket.id}
			)`.mapWith(Number),
		})
		.from(WebsiteTicket)
		.leftJoin(Creator, eq(WebsiteTicket.creatorId, Creator.id))
		.leftJoin(Assignee, eq(WebsiteTicket.assigneeId, Assignee.id))
		.where(where)
		.orderBy(orderBy)
		.limit(pagination.perPage)
		.offset(pagination.offset)
		.catch(() => []);

	const rows: TicketRow[] = tickets.map((ticket) => ({
		id: ticket.id,
		subject: ticket.subject,
		creator: ticket.creatorUsername ?? "—",
		creatorId: ticket.creatorId,
		category: ticket.category,
		messages: Number(ticket.messageCount ?? 0),
		status: ticket.status,
		awaitingStaff:
			ticket.status !== "closed" && Number(ticket.replyIsStaff) === 0,
		replyAgeMinutes: ticketReplyAge(ticket.replyAt),
		priority: ticket.priority,
		assignee: ticket.assigneeUsername ?? "—",
		date: formatDate(ticket.createdAt, "date"),
	}));

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
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5">
				<StatusCard label={t("statusOpen")} value={openCount} icon="🎫" />
				<StatusCard
					label={t("statusInProgress")}
					value={inProgressCount}
					state={inProgressCount > 0 ? "warn" : "neutral"}
					icon="⏳"
				/>
				<StatusCard
					label={t("statusWaiting")}
					value={waitingCount}
					state={waitingCount > 0 ? "warn" : "neutral"}
					icon="🕒"
				/>
				<StatusCard label={t("statusClosed")} value={closedCount} icon="✅" />
			</div>

			{total === 0 &&
			!parsed.search &&
			statusFilter === "active" &&
			!raw.filter_assignee ? (
				<div className="admin-empty">{t("noTickets")}</div>
			) : (
				<TicketsTable
					basePath="/admin/tickets"
					data={{
						rows,
						total,
						page: pagination.page,
						perPage: pagination.perPage,
						lastPage: pagination.lastPage,
					}}
				/>
			)}
		</div>
	);
}
