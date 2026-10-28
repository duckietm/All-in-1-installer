import {
	and,
	asc,
	count,
	desc,
	eq,
	inArray,
	like,
	ne,
	or,
	type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { getTranslations } from "next-intl/server";
import {
	type TicketRow,
	TicketsTable,
} from "@/app/admin/tickets/tickets-table";
import { StatusCard } from "@/components/admin/dashboard";
import { TicketQueueBanner } from "@/components/admin/ticket-queue-banner";
import { requireModPermission } from "@/lib/admin/guard";
import {
	awaitingStaffCondition,
	latestTicketReplyAt,
	latestTicketReplyIsStaff,
	ticketAssignmentCondition,
} from "@/lib/admin/ticket-desk-query";
import { fetchTicketQueueOpenCounts } from "@/lib/admin/ticket-queue-counts";
import { ticketReplyAge } from "@/lib/admin/ticket-reply-age";
import { calcPagination, parseListParams } from "@/lib/admin-helpers";
import { db, User, WebsiteTicket, WebsiteTicketMessage } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { PERMS } from "@/lib/permissions";

const Creator = alias(User, "ticket_creator");
const Assignee = alias(User, "ticket_assignee");

const SORT_COLS = {
	subject: WebsiteTicket.subject,
	status: WebsiteTicket.status,
	priority: WebsiteTicket.priority,
	assignee: WebsiteTicket.assigneeId,
	date: WebsiteTicket.createdAt,
	id: WebsiteTicket.id,
} as const;

export default async function ModTicketsDeskPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	const staff = await requireModPermission([
		PERMS.MOD_TICKETS_VIEW,
		PERMS.TICKETS_VIEW,
	]);

	const t = await getTranslations("pages.admin.tickets");
	const raw = await searchParams;
	const parsed = parseListParams(new URLSearchParams(raw));
	const statusFilter = raw.filter_status || raw.status || "active";

	const conditions: SQL[] = [];
	const assignment = ticketAssignmentCondition(raw.filter_assignee, staff.id);
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
		const ors: SQL[] = [
			like(WebsiteTicket.subject, `%${q}%`),
			like(WebsiteTicket.category, `%${q}%`),
			like(Creator.username, `%${q}%`),
			like(Assignee.username, `%${q}%`),
		];
		if (Number.isFinite(asId) && asId > 0) {
			ors.push(eq(WebsiteTicket.id, asId));
		}
		const searchFilter = or(...ors);
		if (searchFilter) conditions.push(searchFilter);
	}

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const sortKey =
		parsed.sort && parsed.sort in SORT_COLS
			? (parsed.sort as keyof typeof SORT_COLS)
			: "date";
	const sortCol = SORT_COLS[sortKey];
	const finalOrder =
		parsed.sort && parsed.sort in SORT_COLS
			? parsed.order === "asc"
				? asc(sortCol)
				: desc(sortCol)
			: desc(WebsiteTicket.createdAt);

	const [total, openCount, inProgressCount, waitingCount, closedCount, queues] =
		await Promise.all([
			db
				.select({ total: count() })
				.from(WebsiteTicket)
				.leftJoin(Creator, eq(WebsiteTicket.creatorId, Creator.id))
				.leftJoin(Assignee, eq(WebsiteTicket.assigneeId, Assignee.id))
				.where(where)
				.then((rows) => rows[0]?.total ?? 0)
				.catch(() => 0),
			db
				.select({ total: count() })
				.from(WebsiteTicket)
				.where(eq(WebsiteTicket.status, "open"))
				.then((rows) => rows[0]?.total ?? 0)
				.catch(() => 0),
			db
				.select({ total: count() })
				.from(WebsiteTicket)
				.where(eq(WebsiteTicket.status, "in_progress"))
				.then((rows) => rows[0]?.total ?? 0)
				.catch(() => 0),
			db
				.select({ total: count() })
				.from(WebsiteTicket)
				.where(eq(WebsiteTicket.status, "waiting"))
				.then((rows) => rows[0]?.total ?? 0)
				.catch(() => 0),
			db
				.select({ total: count() })
				.from(WebsiteTicket)
				.where(eq(WebsiteTicket.status, "closed"))
				.then((rows) => rows[0]?.total ?? 0)
				.catch(() => 0),
			fetchTicketQueueOpenCounts(),
		]);

	const pagination = calcPagination(total, parsed.page, parsed.perPage);

	const tickets = await db
		.select({
			id: WebsiteTicket.id,
			subject: WebsiteTicket.subject,
			category: WebsiteTicket.category,
			status: WebsiteTicket.status,
			priority: WebsiteTicket.priority,
			creatorId: WebsiteTicket.creatorId,
			createdAt: WebsiteTicket.createdAt,
			creatorUsername: Creator.username,
			assigneeUsername: Assignee.username,
			replyAt: latestTicketReplyAt,
			replyIsStaff: latestTicketReplyIsStaff,
		})
		.from(WebsiteTicket)
		.leftJoin(Creator, eq(WebsiteTicket.creatorId, Creator.id))
		.leftJoin(Assignee, eq(WebsiteTicket.assigneeId, Assignee.id))
		.where(where)
		.orderBy(finalOrder)
		.offset(pagination.offset)
		.limit(pagination.perPage)
		.catch(() => []);

	const ticketIds = tickets.map((ticket) => ticket.id);
	const msgRows =
		ticketIds.length > 0
			? await db
					.select({
						ticketId: WebsiteTicketMessage.ticketId,
						total: count(),
					})
					.from(WebsiteTicketMessage)
					.where(inArray(WebsiteTicketMessage.ticketId, ticketIds))
					.groupBy(WebsiteTicketMessage.ticketId)
					.catch(() => [])
			: [];
	const msgMap = new Map(msgRows.map((m) => [m.ticketId, m.total]));

	const rows: TicketRow[] = tickets.map((ticket) => ({
		id: ticket.id,
		subject: ticket.subject,
		creator: ticket.creatorUsername ?? "—",
		creatorId: ticket.creatorId,
		category: ticket.category,
		messages: msgMap.get(ticket.id) ?? 0,
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
				otherHref="/mod/help-tickets"
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
					basePath="/mod/tickets"
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
