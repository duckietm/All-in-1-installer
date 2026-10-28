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
import { type CfhRow, CfhTable } from "@/app/admin/moderation/cfh/cfh-table";
import { requireModPermission } from "@/lib/admin/guard";
import { calcPagination, parseListParams } from "@/lib/admin-helpers";
import { db, SupportTickets, User } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { PERMS } from "@/lib/permissions";
import { logServerError } from "@/lib/server-log";

const SORT_COLS = {
	id: SupportTickets.id,
	issue: SupportTickets.issue,
	sender: SupportTickets.senderId,
	reported: SupportTickets.reportedId,
	mod: SupportTickets.modId,
	state: SupportTickets.state,
} as const;

export default async function ModCfhListPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string>>;
}) {
	await requireModPermission([PERMS.MOD_CFH_VIEW, PERMS.MODERATION_VIEW]);

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
		} catch (error) {
			logServerError("cfh.user_search_failed", error, { query: q });
			userIds = [];
		}

		const ors: SQL[] = [like(SupportTickets.issue, `%${q}%`)];
		if (Number.isFinite(asId) && asId > 0) {
			ors.push(eq(SupportTickets.id, asId));
		}
		if (userIds.length) {
			ors.push(inArray(SupportTickets.senderId, userIds));
			ors.push(inArray(SupportTickets.reportedId, userIds));
			ors.push(inArray(SupportTickets.modId, userIds));
		}
		const searchFilter = or(...ors);
		if (searchFilter) conditions.push(searchFilter);
	}

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const sortKey =
		parsed.sort && parsed.sort in SORT_COLS
			? (parsed.sort as keyof typeof SORT_COLS)
			: "id";
	const sortCol = SORT_COLS[sortKey];
	const finalOrder =
		parsed.sort && parsed.sort in SORT_COLS
			? parsed.order === "asc"
				? asc(sortCol)
				: desc(sortCol)
			: desc(SupportTickets.id);

	const total = await db
		.select({ total: count() })
		.from(SupportTickets)
		.where(where)
		.then((rows) => rows[0]?.total ?? 0)
		.catch((error) => {
			logServerError("cfh.count_failed", error);
			return 0;
		});
	const pagination = calcPagination(total, parsed.page, parsed.perPage);

	const tickets = await db
		.select()
		.from(SupportTickets)
		.where(where)
		.orderBy(finalOrder)
		.offset(pagination.offset)
		.limit(pagination.perPage)
		.catch((error) => {
			logServerError("cfh.query_failed", error);
			return [];
		});

	const userIds = [
		...new Set([
			...tickets.map((x) => x.senderId),
			...tickets.map((x) => x.reportedId),
			...tickets.map((x) => x.modId),
		]),
	].filter(Boolean);

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
					basePath="/mod/cfh"
					userLinkMode="public"
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
