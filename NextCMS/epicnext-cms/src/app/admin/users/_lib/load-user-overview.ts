import { type SQL, sql } from "drizzle-orm";
import { queryRows } from "@/lib/db";
import { canAccess, PERMS, type PermissionSet } from "@/lib/permissions";

export type OverviewRow = {
	id: string | number;
	title: string;
	detail?: string | null;
	status?: string | null;
	at?: string | number | Date | null;
	href?: string;
	amount?: number | null;
	credits?: number | null;
	points?: number | null;
	pointsType?: number | null;
};
export type OverviewSection = {
	key: string;
	href?: string;
	state: "ready" | "error";
	rows: OverviewRow[];
};

export async function loadUserOverview(
	userId: number,
	permissions: PermissionSet,
	rank: number,
): Promise<OverviewSection[]> {
	const read = async (query: SQL): Promise<OverviewRow[]> => {
		return queryRows<OverviewRow>(query);
	};
	const sources: {
		key: string;
		permission: string;
		href?: string;
		query: () => Promise<OverviewRow[]>;
		rowHref?: (id: string | number) => string;
	}[] = [
		{
			key: "sanctions",
			permission: PERMS.BANS_VIEW,
			href: "/admin/bans",
			query: () =>
				read(
					sql`SELECT id, type AS title, LEFT(ban_reason, 180) AS detail, timestamp AS at, CASE WHEN ban_expire = 0 OR ban_expire > UNIX_TIMESTAMP() THEN 'active' ELSE 'expired' END AS status FROM bans WHERE user_id = ${userId} ORDER BY timestamp DESC, id DESC LIMIT 5`,
				),
		},
		{
			key: "mute",
			permission: PERMS.MODERATION_VIEW,
			query: () =>
				read(
					sql`SELECT user_id AS id, '' AS title, mute_end_timestamp AS at FROM users_settings WHERE user_id = ${userId} AND mute_end_timestamp > UNIX_TIMESTAMP() LIMIT 5`,
				),
		},
		{
			key: "tickets",
			permission: PERMS.TICKETS_VIEW,
			query: () =>
				read(
					sql`SELECT id, subject AS title, status, updated_at AS at FROM website_tickets WHERE creator_id = ${userId} ORDER BY updated_at DESC, id DESC LIMIT 5`,
				),
			rowHref: (id) => `/admin/tickets/${id}`,
		},
		{
			key: "help",
			permission: PERMS.TICKETS_VIEW,
			query: () =>
				read(
					sql`SELECT id, title, CASE WHEN open = 1 THEN 'open' ELSE 'closed' END AS status, created_at AS at FROM website_help_center_tickets WHERE user_id = ${userId} ORDER BY created_at DESC, id DESC LIMIT 5`,
				),
			rowHref: (id) => `/admin/help-tickets/${id}`,
		},
		{
			key: "reports",
			permission: PERMS.MODERATION_VIEW,
			query: () =>
				read(
					sql`SELECT id, LEFT(issue, 180) AS title, CASE WHEN reported_id = ${userId} THEN 'reported' ELSE 'reporter' END AS status, timestamp AS at FROM support_tickets WHERE reported_id = ${userId} OR sender_id = ${userId} ORDER BY timestamp DESC, id DESC LIMIT 5`,
				),
			rowHref: (id) => `/admin/moderation/cfh/${id}`,
		},
		{
			key: "transactions",
			permission: PERMS.SHOP_VIEW,
			href: "/admin/transactions",
			query: () =>
				read(
					sql`SELECT id, COALESCE(description, transaction_id) AS title, CONCAT(amount, ' ', currency) AS detail, status, created_at AS at FROM website_paypal_transactions WHERE user_id = ${userId} ORDER BY created_at DESC, id DESC LIMIT 5`,
				),
		},
		{
			key: "purchases",
			permission: PERMS.LOGS_VIEW,
			query: () =>
				read(
					sql`SELECT id, catalog_name AS title, amount, cost_credits AS credits, cost_points AS points, points_type AS pointsType, timestamp AS at FROM logs_shop_purchases WHERE user_id = ${userId} ORDER BY timestamp DESC, id DESC LIMIT 5`,
				),
		},
		{
			key: "activity",
			permission: PERMS.LOGS_VIEW,
			href: "/admin/logs/audit",
			query: () =>
				read(
					sql`SELECT id, action AS title, created_at AS at FROM admin_audit_log WHERE target = 'User' AND target_id = ${userId} ORDER BY id DESC LIMIT 5`,
				),
		},
	];
	// Filter before invoking the query; an inaccessible source must never touch its table.
	return Promise.all(
		sources
			.filter((source) => canAccess(permissions, source.permission, rank))
			.map(async (source) => {
				try {
					const rows = await source.query();
					return {
						key: source.key,
						href: source.href,
						state: "ready" as const,
						rows: rows.map((row) => ({
							...row,
							href: source.rowHref?.(row.id),
						})),
					};
				} catch {
					return {
						key: source.key,
						href: source.href,
						state: "error" as const,
						rows: [],
					};
				}
			}),
	);
}
