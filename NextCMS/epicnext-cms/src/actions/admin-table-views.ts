"use server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { namedTableView, tableViewPath } from "@/lib/admin/table-view-state";
import { db, queryRows, rowsFrom } from "@/lib/db";
import { PERMS } from "@/lib/permission-slugs";
import { adminAction } from "@/lib/safe-action";

const tableViewPermissions = [
	PERMS.ADMIN_DASHBOARD,
	PERMS.MOD_DASHBOARD,
	PERMS.MODERATION_VIEW,
	PERMS.MOD_CFH_VIEW,
	PERMS.MOD_ACTIONS,
	PERMS.MOD_BANS_VIEW,
	PERMS.MOD_TICKETS_VIEW,
	PERMS.MOD_TEAM_VIEW,
	PERMS.MOD_USERS_VIEW,
	PERMS.TICKETS_VIEW,
] as const;

export const listTableViews = adminAction(
	{
		permission: tableViewPermissions,
		schema: z.object({ path: tableViewPath }),
	},
	async ({ session, data }) => {
		const views = (
			await queryRows<{ name: string; state: string }>(
				sql`SELECT name, state FROM website_admin_table_views WHERE user_id = ${Number(session.user.id)} AND path = ${data.path} ORDER BY name LIMIT 20`,
			)
		).flatMap((row) => {
			try {
				const parsed = namedTableView.safeParse({
					name: row.name,
					state: JSON.parse(row.state),
				});
				return parsed.success ? [parsed.data] : [];
			} catch {
				return [];
			}
		});
		return { ok: true, data: { views } };
	},
);
export const saveTableView = adminAction(
	{
		permission: tableViewPermissions,
		schema: namedTableView.extend({ path: tableViewPath }),
		rateLimitKey: "table-view-save",
		rateLimitMax: 30,
		rateLimitWindowMs: 60000,
	},
	async ({ session, data }) => {
		const userId = Number(session.user.id);
		await db.transaction(async (tx) => {
			await tx.execute(
				sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`,
			);
			const names = rowsFrom<{ name: string }>(
				await tx.execute(
					sql`SELECT name FROM website_admin_table_views WHERE user_id = ${userId} AND path = ${data.path}`,
				),
			);
			if (
				names.length >= 20 &&
				!names.some(
					(row) =>
						row.name.toLocaleLowerCase() === data.name.toLocaleLowerCase(),
				)
			)
				throw new Error("Maximum 20 saved views per table");
			await tx.execute(
				sql`INSERT INTO website_admin_table_views (user_id,path,name,state) VALUES (${userId},${data.path},${data.name},${JSON.stringify(data.state)}) ON DUPLICATE KEY UPDATE state = VALUES(state)`,
			);
		});
		return { ok: true };
	},
);
export const deleteTableView = adminAction(
	{
		permission: tableViewPermissions,
		schema: z.object({ path: tableViewPath, name: z.string().min(1).max(60) }),
	},
	async ({ session, data }) => {
		await db.execute(
			sql`DELETE FROM website_admin_table_views WHERE user_id = ${Number(session.user.id)} AND path = ${data.path} AND name = ${data.name}`,
		);
		return { ok: true };
	},
);
