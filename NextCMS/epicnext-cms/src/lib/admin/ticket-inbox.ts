import "server-only";

import { and, count, eq, like, ne, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { calcPagination } from "@/lib/admin-helpers";
import {
	db,
	queryRows,
	User,
	WebsiteHelpCenterTickets,
	WebsiteTicket,
} from "@/lib/db";
import { formatDate } from "@/lib/format-date";
import { logger } from "@/lib/logger";

export type TicketInboxKind = "cms" | "help";
export type TicketInboxTypeFilter = "all" | TicketInboxKind;

export interface TicketInboxRow {
	key: string;
	kind: TicketInboxKind;
	id: string;
	title: string;
	user: string;
	userId: number | null;
	status: string;
	open: boolean;
	sortAt: number;
	date: string;
	href: string;
}

export interface FetchTicketInboxOptions {
	page: number;
	perPage: number;
	search?: string;
	type?: TicketInboxTypeFilter;
	/** Default true: only non-closed CMS + open help-center. */
	openOnly?: boolean;
	base?: "admin" | "mod";
}

interface InboxRawRow {
	kind: TicketInboxKind;
	id: string;
	title: string;
	username: string | null;
	user_id: number | null;
	status: string;
	is_open: number | boolean;
	sort_at: Date | null;
}

function toSortMs(value: Date | string | null | undefined): number {
	if (!value) return 0;
	const ms =
		value instanceof Date ? value.getTime() : Date.parse(String(value));
	return Number.isFinite(ms) ? ms : 0;
}

/**
 * Builds a single UNION ALL over both queues, normalized to the same column
 * shape so the database can apply ORDER BY + LIMIT/OFFSET. This keeps deep
 * pages O(perPage) instead of materializing every row up to the offset (the
 * previous app-side merge fetched `offset + perPage` rows from each source).
 *
 * Ordering matches the old merge: newest first, ties broken by descending
 * `kind` then descending string `id` (equivalent to the old `${kind}-${id}`
 * key comparison).
 */
function buildInboxUnion(
	includeCms: boolean,
	includeHelp: boolean,
	search: string,
	openOnly: boolean,
): SQL {
	const branches: SQL[] = [];

	if (includeCms) {
		const conditions: SQL[] = [];
		if (openOnly) conditions.push(sql`t.status <> 'closed'`);
		if (search) {
			const pattern = `%${search}%`;
			const parts: SQL[] = [
				sql`t.subject LIKE ${pattern}`,
				sql`t.category LIKE ${pattern}`,
				sql`EXISTS (SELECT 1 FROM users cu WHERE cu.id = t.creator_id AND cu.username LIKE ${pattern})`,
			];
			const asId = Number(search);
			if (Number.isFinite(asId) && asId > 0) parts.push(sql`t.id = ${asId}`);
			conditions.push(sql`(${sql.join(parts, sql` OR `)})`);
		}
		const where =
			conditions.length > 0
				? sql` WHERE ${sql.join(conditions, sql` AND `)}`
				: sql``;
		branches.push(sql`
			SELECT 'cms' AS kind, CAST(t.id AS CHAR) AS id, t.subject AS title,
				cu.username AS username, t.creator_id AS user_id, t.status AS status,
				(t.status <> 'closed') AS is_open,
				COALESCE(t.updated_at, t.created_at) AS sort_at
			FROM website_tickets t
			LEFT JOIN users cu ON cu.id = t.creator_id${where}
		`);
	}

	if (includeHelp) {
		const conditions: SQL[] = [];
		if (openOnly) conditions.push(sql`h.open = 1`);
		if (search) {
			const pattern = `%${search}%`;
			const parts: SQL[] = [
				sql`h.title LIKE ${pattern}`,
				sql`h.content LIKE ${pattern}`,
				sql`EXISTS (SELECT 1 FROM users hu WHERE hu.id = h.user_id AND hu.username LIKE ${pattern})`,
			];
			if (/^\d+$/.test(search)) parts.push(sql`h.id = ${search}`);
			conditions.push(sql`(${sql.join(parts, sql` OR `)})`);
		}
		const where =
			conditions.length > 0
				? sql` WHERE ${sql.join(conditions, sql` AND `)}`
				: sql``;
		branches.push(sql`
			SELECT 'help' AS kind, CAST(h.id AS CHAR) AS id, h.title AS title,
				hu.username AS username, h.user_id AS user_id,
				IF(h.open = 1, 'open', 'closed') AS status, h.open AS is_open,
				COALESCE(h.updated_at, h.created_at) AS sort_at
			FROM website_help_center_tickets h
			LEFT JOIN users hu ON hu.id = h.user_id${where}
		`);
	}

	return sql.join(branches, sql` UNION ALL `);
}

/** Merged read-model over CMS desk + help-center queues (single DB query). */
export async function fetchUnifiedTicketInbox(
	options: FetchTicketInboxOptions,
): Promise<{
	rows: TicketInboxRow[];
	total: number;
	page: number;
	perPage: number;
	lastPage: number;
	cmsTotal: number;
	helpTotal: number;
}> {
	const type = options.type ?? "all";
	const openOnly = options.openOnly !== false;
	const search = options.search?.trim() ?? "";
	const base = options.base ?? "admin";

	const includeCms = type === "all" || type === "cms";
	const includeHelp = type === "all" || type === "help";

	const [cmsTotal, helpTotal] = await Promise.all([
		includeCms ? countCms(search, openOnly) : Promise.resolve(0),
		includeHelp ? countHelp(search, openOnly) : Promise.resolve(0),
	]);

	const total = cmsTotal + helpTotal;
	const pagination = calcPagination(total, options.page, options.perPage);

	const cmsPrefix = base === "mod" ? "/mod/tickets" : "/admin/tickets";
	const helpPrefix =
		base === "mod" ? "/mod/help-tickets" : "/admin/help-tickets";

	let rows: TicketInboxRow[] = [];
	if (includeCms || includeHelp) {
		const union = buildInboxUnion(includeCms, includeHelp, search, openOnly);
		try {
			const raw = await queryRows<InboxRawRow>(sql`
				SELECT * FROM (${union}) AS merged
				ORDER BY sort_at DESC, kind DESC, id DESC
				LIMIT ${pagination.perPage} OFFSET ${pagination.offset}
			`);
			rows = raw.map((row) => {
				const open = Boolean(row.is_open);
				return {
					key: `${row.kind}-${row.id}`,
					kind: row.kind,
					id: String(row.id),
					title: row.title,
					user:
						row.username ??
						(row.kind === "help" && row.user_id != null
							? `#${row.user_id}`
							: "—"),
					userId: row.user_id,
					status: row.kind === "cms" ? row.status : open ? "open" : "closed",
					open,
					sortAt: toSortMs(row.sort_at),
					date: formatDate(row.sort_at, "date"),
					href:
						row.kind === "cms"
							? `${cmsPrefix}/${row.id}`
							: `${helpPrefix}/${row.id}`,
				};
			});
		} catch (error) {
			logger.error("Failed to load unified ticket inbox", { error });
		}
	}

	return {
		rows,
		total,
		page: pagination.page,
		perPage: pagination.perPage,
		lastPage: pagination.lastPage,
		cmsTotal,
		helpTotal,
	};
}

async function countCms(search: string, openOnly: boolean): Promise<number> {
	const Creator = alias(User, "inbox_ticket_creator_count");
	const conditions: SQL[] = [];
	if (openOnly) conditions.push(ne(WebsiteTicket.status, "closed"));
	if (search) {
		const asId = Number(search);
		const searchFilter = or(
			like(WebsiteTicket.subject, `%${search}%`),
			like(WebsiteTicket.category, `%${search}%`),
			like(Creator.username, `%${search}%`),
			...(Number.isFinite(asId) && asId > 0
				? [eq(WebsiteTicket.id, asId)]
				: []),
		);
		if (searchFilter) conditions.push(searchFilter);
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined;
	const rows = await db
		.select({ total: count() })
		.from(WebsiteTicket)
		.leftJoin(Creator, eq(WebsiteTicket.creatorId, Creator.id))
		.where(where)
		.catch(() => [{ total: 0 }]);
	return Number(rows[0]?.total ?? 0);
}

async function countHelp(search: string, openOnly: boolean): Promise<number> {
	const conditions: SQL[] = [];
	if (openOnly) conditions.push(eq(WebsiteHelpCenterTickets.open, true));
	if (search) {
		const pattern = `%${search}%`;
		const asId = /^\d+$/.test(search) ? BigInt(search) : null;
		const searchFilter = or(
			like(WebsiteHelpCenterTickets.title, pattern),
			like(WebsiteHelpCenterTickets.content, pattern),
			sql`EXISTS (SELECT 1 FROM users hu WHERE hu.id = ${WebsiteHelpCenterTickets.userId} AND hu.username LIKE ${pattern})`,
			...(asId !== null ? [eq(WebsiteHelpCenterTickets.id, asId)] : []),
		);
		if (searchFilter) conditions.push(searchFilter);
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined;
	const rows = await db
		.select({ total: count() })
		.from(WebsiteHelpCenterTickets)
		.where(where)
		.catch(() => [{ total: 0 }]);
	return Number(rows[0]?.total ?? 0);
}
