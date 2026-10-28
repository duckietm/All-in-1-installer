import {
	and,
	asc,
	count,
	desc,
	eq,
	inArray,
	like,
	or,
	type SQL,
} from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import {
	type HelpTicketRow,
	HelpTicketsTable,
} from "@/app/admin/help-tickets/help-tickets-table";
import { StatusCard } from "@/components/admin/dashboard";
import { TicketQueueBanner } from "@/components/admin/ticket-queue-banner";
import { requireModPermission } from "@/lib/admin/guard";
import { fetchTicketQueueOpenCounts } from "@/lib/admin/ticket-queue-counts";
import { calcPagination, parseListParams } from "@/lib/admin-helpers";
import {
	db,
	User,
	WebsiteHelpCenterTicketReplies,
	WebsiteHelpCenterTickets,
} from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { PERMS } from "@/lib/permissions";

const SORT_COLS = {
	title: WebsiteHelpCenterTickets.title,
	open: WebsiteHelpCenterTickets.open,
	user: WebsiteHelpCenterTickets.userId,
	date: WebsiteHelpCenterTickets.createdAt,
	updated: WebsiteHelpCenterTickets.updatedAt,
	id: WebsiteHelpCenterTickets.id,
} as const;

export default async function ModHelpTicketsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	await requireModPermission([PERMS.MOD_TICKETS_VIEW, PERMS.TICKETS_VIEW]);

	const t = await getTranslations("pages.admin.helpTickets");
	const raw = await searchParams;
	const parsed = parseListParams(new URLSearchParams(raw));
	const statusFilter = raw.filter_status || "open";

	const conditions: SQL[] = [];

	if (statusFilter === "open") {
		conditions.push(eq(WebsiteHelpCenterTickets.open, true));
	} else if (statusFilter === "closed") {
		conditions.push(eq(WebsiteHelpCenterTickets.open, false));
	}

	if (parsed.search.trim()) {
		const q = parsed.search.trim();
		const asId = /^\d+$/.test(q) ? BigInt(q) : null;
		const matchingUsers = await db
			.select({ id: User.id })
			.from(User)
			.where(like(User.username, `%${q}%`))
			.limit(50)
			.catch(() => []);

		const ors: SQL[] = [
			like(WebsiteHelpCenterTickets.title, `%${q}%`),
			like(WebsiteHelpCenterTickets.content, `%${q}%`),
		];
		if (matchingUsers.length > 0) {
			ors.push(
				inArray(
					WebsiteHelpCenterTickets.userId,
					matchingUsers.map((u) => u.id),
				),
			);
		}
		if (asId !== null) {
			ors.push(eq(WebsiteHelpCenterTickets.id, asId));
		}
		const searchFilter = or(...ors);
		if (searchFilter) conditions.push(searchFilter);
	}

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const sortKey =
		parsed.sort && parsed.sort in SORT_COLS
			? (parsed.sort as keyof typeof SORT_COLS)
			: "updated";
	const sortCol = SORT_COLS[sortKey];
	const finalOrder =
		parsed.sort && parsed.sort in SORT_COLS
			? parsed.order === "asc"
				? asc(sortCol)
				: desc(sortCol)
			: desc(WebsiteHelpCenterTickets.updatedAt);

	const [total, openCount, closedCount, queues] = await Promise.all([
		db
			.select({ total: count() })
			.from(WebsiteHelpCenterTickets)
			.where(where)
			.then((rows) => rows[0]?.total ?? 0)
			.catch(() => 0),
		db
			.select({ total: count() })
			.from(WebsiteHelpCenterTickets)
			.where(eq(WebsiteHelpCenterTickets.open, true))
			.then((rows) => rows[0]?.total ?? 0)
			.catch(() => 0),
		db
			.select({ total: count() })
			.from(WebsiteHelpCenterTickets)
			.where(eq(WebsiteHelpCenterTickets.open, false))
			.then((rows) => rows[0]?.total ?? 0)
			.catch(() => 0),
		fetchTicketQueueOpenCounts(),
	]);

	const pagination = calcPagination(total, parsed.page, parsed.perPage);

	const tickets = await db
		.select({
			id: WebsiteHelpCenterTickets.id,
			userId: WebsiteHelpCenterTickets.userId,
			title: WebsiteHelpCenterTickets.title,
			open: WebsiteHelpCenterTickets.open,
			createdAt: WebsiteHelpCenterTickets.createdAt,
			updatedAt: WebsiteHelpCenterTickets.updatedAt,
		})
		.from(WebsiteHelpCenterTickets)
		.where(where)
		.orderBy(finalOrder)
		.offset(pagination.offset)
		.limit(pagination.perPage)
		.catch(() => []);

	const ticketIds = tickets.map((ticket) => ticket.id);
	const userIds = [
		...new Set(
			tickets
				.map((ticket) => ticket.userId)
				.filter((id): id is number => id != null),
		),
	];

	const [replyGroups, users] = await Promise.all([
		ticketIds.length > 0
			? db
					.select({
						ticketId: WebsiteHelpCenterTicketReplies.ticketId,
						total: count(),
					})
					.from(WebsiteHelpCenterTicketReplies)
					.where(inArray(WebsiteHelpCenterTicketReplies.ticketId, ticketIds))
					.groupBy(WebsiteHelpCenterTicketReplies.ticketId)
					.catch(() => [])
			: Promise.resolve([]),
		userIds.length > 0
			? db
					.select({ id: User.id, username: User.username })
					.from(User)
					.where(inArray(User.id, userIds))
					.catch(() => [])
			: Promise.resolve([]),
	]);

	const replyCountByTicket = new Map(
		replyGroups.map((g) => [String(g.ticketId), g.total]),
	);
	const usernameById = new Map(users.map((u) => [u.id, u.username]));

	const rows: HelpTicketRow[] = tickets.map((ticket) => ({
		id: String(ticket.id),
		title: ticket.title,
		user:
			ticket.userId != null
				? (usernameById.get(ticket.userId) ?? `#${ticket.userId}`)
				: "—",
		userId: ticket.userId,
		replies: replyCountByTicket.get(String(ticket.id)) ?? 0,
		open: ticket.open,
		date: formatDate(ticket.createdAt, "date"),
		updated: formatDate(ticket.updatedAt, "date"),
	}));

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
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5">
				<StatusCard label={t("statusOpen")} value={openCount} icon="🎫" />
				<StatusCard label={t("statusClosed")} value={closedCount} icon="✅" />
			</div>

			{total === 0 && !parsed.search && statusFilter === "open" ? (
				<div className="admin-empty">{t("noTickets")}</div>
			) : (
				<HelpTicketsTable
					basePath="/mod/help-tickets"
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
