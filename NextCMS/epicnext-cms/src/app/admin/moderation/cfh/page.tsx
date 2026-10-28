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
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { calcPagination, parseListParams } from "@/lib/admin-helpers";
import { db, SupportTickets, User } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { type CfhRow, CfhTable } from "./cfh-table";

export default async function CfhListPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.MODERATION_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.cfh");
	const raw = await searchParams;
	const parsed = parseListParams(new URLSearchParams(raw));
	const stateRaw = raw.filter_state ?? raw.state;
	const stateFilter =
		stateRaw !== undefined && stateRaw !== "" ? Number(stateRaw) : -1;

	const conditions: SQL[] = [];
	if (stateFilter >= 0) {
		conditions.push(eq(SupportTickets.state, stateFilter));
	}

	if (parsed.search.trim()) {
		const q = parsed.search.trim();
		const asId = Number(q);
		let userIds: number[] = [];
		try {
			const users = await db
				.select({ id: User.id })
				.from(User)
				.where(like(User.username, `%${q}%`))
				.limit(50);
			userIds = users.map((u) => u.id);
		} catch {
			userIds = [];
		}

		const searchFilter = or(
			like(SupportTickets.issue, `%${q}%`),
			...(Number.isFinite(asId) && asId > 0
				? [eq(SupportTickets.id, asId)]
				: []),
			...(userIds.length
				? [
						inArray(SupportTickets.senderId, userIds),
						inArray(SupportTickets.reportedId, userIds),
						inArray(SupportTickets.modId, userIds),
					]
				: []),
		);
		if (searchFilter) conditions.push(searchFilter);
	}

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const orderCol =
		parsed.sort === "issue"
			? SupportTickets.issue
			: parsed.sort === "sender"
				? SupportTickets.senderId
				: parsed.sort === "reported"
					? SupportTickets.reportedId
					: parsed.sort === "mod"
						? SupportTickets.modId
						: parsed.sort === "state"
							? SupportTickets.state
							: SupportTickets.id;
	const orderBy = parsed.order === "asc" ? asc(orderCol) : desc(orderCol);

	const [totalRows] = await db
		.select({ total: count() })
		.from(SupportTickets)
		.where(where)
		.catch(() => [{ total: 0 }]);
	const total = Number(totalRows?.total ?? 0);
	const pagination = calcPagination(total, parsed.page, parsed.perPage);

	const tickets = await db
		.select()
		.from(SupportTickets)
		.where(where)
		.orderBy(orderBy)
		.limit(pagination.perPage)
		.offset(pagination.offset)
		.catch(() => []);

	const userIds = [
		...new Set([
			...tickets.map((x) => x.senderId),
			...tickets.map((x) => x.reportedId),
			...tickets.map((x) => x.modId),
		]),
	].filter(Boolean) as number[];

	let userMap = new Map<number, string>();
	if (userIds.length > 0) {
		try {
			const users = await db
				.select({ id: User.id, username: User.username })
				.from(User)
				.where(inArray(User.id, userIds));
			userMap = new Map(users.map((u) => [u.id, u.username]));
		} catch {
			userMap = new Map();
		}
	}

	const stateLabels: Record<number, string> = {
		0: t("stateOpen"),
		1: t("statePicked"),
		2: t("stateClosed"),
	};

	const rows: CfhRow[] = tickets.map((ticket) => ({
		id: ticket.id,
		issue: ticket.issue,
		roomId: ticket.roomId,
		when: ticket.timestamp
			? formatDate(new Date(ticket.timestamp * 1000))
			: "—",
		sender: userMap.get(ticket.senderId) ?? "—",
		senderId: ticket.senderId,
		reported: userMap.get(ticket.reportedId) ?? "—",
		reportedId: ticket.reportedId,
		mod: userMap.get(ticket.modId) ?? "—",
		state: ticket.state,
		stateLabel: stateLabels[ticket.state] ?? String(ticket.state),
	}));

	return (
		<div className="space-y-6">
			{total === 0 && !parsed.search && stateFilter < 0 ? (
				<div className="admin-empty">{t("noTickets")}</div>
			) : (
				<CfhTable
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
