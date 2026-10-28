import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { calcPagination, parseListParams } from "@/lib/admin-helpers";
import { queryRows } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

type ListParamsInput = {
	searchParams: Promise<Record<string, string>>;
	defaultPerPage?: number;
};

type SqlFragment = ReturnType<typeof sql>;

type LogListSpec<RawRow, Row> = {
	select: SqlFragment;
	from: SqlFragment;
	searchWhere: (like: string) => SqlFragment;
	orderBy: SqlFragment;
	mapRow: (raw: RawRow, index: number, offset: number) => Row;
};

async function requireLogsView() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.LOGS_VIEW, session.user.rank)) {
		redirect("/admin");
	}
}

function parsePageParams(
	rawParams: Record<string, string>,
	defaultPerPage: number,
) {
	const sp = new URLSearchParams(rawParams);
	const parsed = parseListParams(sp);
	// parseListParams clamps perPage to 1..100 — use it instead of the raw value.
	const perPage = parsed.perPage || defaultPerPage;
	return { search: parsed.search.trim(), page: parsed.page, perPage };
}

async function rawRows<T>(query: SqlFragment): Promise<T[]> {
	return queryRows<T>(query);
}

/**
 * Shared list loader for the chat / command / trade log tables. The SQL
 * fragments come from a per-table spec while the request handling, search
 * branching, count + pagination and row mapping stay in one place.
 */
async function loadLogList<RawRow, Row>(
	input: ListParamsInput,
	spec: LogListSpec<RawRow, Row>,
): Promise<{
	rows: Row[];
	total: number;
	page: number;
	perPage: number;
	lastPage: number;
	offset: number;
}> {
	await requireLogsView();

	const rawParams = await input.searchParams;
	const { search, page, perPage } = parsePageParams(
		rawParams,
		input.defaultPerPage ?? 50,
	);
	// Cap the offset: `?page=1000000` otherwise builds a multi-hundred-million
	// row scan before returning an empty page.
	const offset = Math.min((page - 1) * perPage, 100_000);
	const like = `%${search.slice(0, 100)}%`;
	const where = search ? sql`WHERE ${spec.searchWhere(like)}` : sql``;

	const [rawRowsResult, countRows] = await Promise.all([
		rawRows<RawRow>(
			sql`${spec.select} ${spec.from} ${where} ${spec.orderBy} LIMIT ${perPage} OFFSET ${offset}`,
		),
		rawRows<{ count: bigint }>(
			sql`SELECT COUNT(*) AS count ${spec.from} ${where}`,
		),
	]);

	const total = Number(countRows[0]?.count ?? 0);
	const pagination = calcPagination(total, page, perPage);
	const rows = rawRowsResult.map((row, index) =>
		spec.mapRow(row, index, pagination.offset),
	);

	return { rows, ...pagination };
}

export type ChatLogListRow = {
	id: number;
	username: string;
	message: string;
	timestamp: number;
	roomId: number;
};

export function loadChatLogList(input: ListParamsInput) {
	type RawRow = {
		roomId: number;
		message: string;
		timestamp: number;
		username: string | null;
	};

	return loadLogList<RawRow, ChatLogListRow>(input, {
		select: sql`SELECT c.room_id AS roomId, c.message, c.timestamp, u.username AS username`,
		from: sql`FROM chatlogs_room c LEFT JOIN users u ON u.id = c.user_from_id`,
		searchWhere: (like) =>
			sql`c.message LIKE ${like} OR u.username LIKE ${like}`,
		orderBy: sql`ORDER BY c.timestamp DESC`,
		mapRow: (row, index, offset) => ({
			id: offset + index + 1,
			username: row.username ?? "-",
			message: row.message,
			timestamp: row.timestamp,
			roomId: row.roomId,
		}),
	});
}

export type CommandLogListRow = {
	id: number;
	username: string;
	command: string;
	params: string;
	timestamp: number;
};

export function loadCommandLogList(input: ListParamsInput) {
	type RawRow = {
		command: string;
		params: string;
		timestamp: number;
		username: string | null;
	};

	return loadLogList<RawRow, CommandLogListRow>(input, {
		select: sql`SELECT c.command, c.params, c.timestamp, u.username AS username`,
		from: sql`FROM commandlogs c LEFT JOIN users u ON u.id = c.user_id`,
		searchWhere: (like) =>
			sql`c.command LIKE ${like} OR c.params LIKE ${like} OR u.username LIKE ${like}`,
		orderBy: sql`ORDER BY c.timestamp DESC`,
		mapRow: (row, index, offset) => ({
			id: offset + index + 1,
			username: row.username ?? "-",
			command: row.command,
			params: row.params,
			timestamp: row.timestamp,
		}),
	});
}

export type TradeLogListRow = {
	id: number;
	userOneName: string;
	userTwoName: string;
	status: string;
	timestamp: number;
};

export function loadTradeLogList(input: ListParamsInput) {
	type RawRow = {
		id: number;
		timestamp: number;
		userOneName: string | null;
		userTwoName: string | null;
	};

	return loadLogList<RawRow, TradeLogListRow>(input, {
		select: sql`SELECT t.id, t.timestamp, u1.username AS userOneName, u2.username AS userTwoName`,
		from: sql`FROM room_trade_log t LEFT JOIN users u1 ON u1.id = t.user_one_id LEFT JOIN users u2 ON u2.id = t.user_two_id`,
		searchWhere: (like) =>
			sql`u1.username LIKE ${like} OR u2.username LIKE ${like}`,
		orderBy: sql`ORDER BY t.timestamp DESC`,
		mapRow: (row) => ({
			id: row.id,
			userOneName: row.userOneName ?? "-",
			userTwoName: row.userTwoName ?? "-",
			// room_trade_log only stores completed trades; no status column exists
			status: "completed",
			timestamp: row.timestamp,
		}),
	});
}
