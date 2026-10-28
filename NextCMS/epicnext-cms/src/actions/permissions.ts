"use server";

import { and, count, eq, inArray, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import {
	AclModelPermission,
	AclModelRole,
	AclPermission,
	AclRole,
	db,
	User,
} from "@/lib/db";
import { PERMS } from "@/lib/permission-slugs";
import { adminAction } from "@/lib/safe-action";
import { ActionError, actionOk } from "@/lib/safe-action-shared";
import {
	createEmulatorRank,
	deleteEmulatorRank,
	updateEmulatorRank,
} from "@/lib/services/permission-ranks";
import { rcon } from "@/lib/services/rcon";
import { logStaffActivity } from "@/lib/services/staff-activity";

const createRankSchema = z.object({
	rank_name: z.string().trim().min(1).max(25),
	level: z.coerce.number().int().min(1),
});

export const createRank = adminAction(
	{ schema: createRankSchema, permission: PERMS.PERMISSIONS_MANAGE },
	async (ctx) => {
		const id = await createEmulatorRank(db, ctx.data);
		await db
			.insert(AclRole)
			.values({
				slug: `rank_${id}`,
				title: ctx.data.rank_name,
				description: "CMS role synchronized from permission_ranks",
			})
			.onDuplicateKeyUpdate({ set: { title: ctx.data.rank_name } });
		await logStaffActivity({
			staffId: ctx.session.user.id,
			action: "rank_create",
			description: `Created rank #${id}`,
			targetType: "rank",
			targetId: id,
		});
		await rcon.send("updatepermissions");
		revalidateTag("permissions", { expire: 0 });
		return actionOk({ id });
	},
);

const deleteRankSchema = z.object({ id: z.coerce.number().int().positive() });

export const deleteRank = adminAction(
	{ schema: deleteRankSchema, permission: PERMS.PERMISSIONS_MANAGE },
	async (ctx) => {
		const [userCount] = await db
			.select({ total: count() })
			.from(User)
			.where(eq(User.rank, ctx.data.id));
		const users = userCount?.total ?? 0;
		if (users > 0)
			throw new ActionError(`Cannot delete: ${users} users have this rank`);
		const [role] = await db
			.select({ id: AclRole.id })
			.from(AclRole)
			.where(eq(AclRole.slug, `rank_${ctx.data.id}`))
			.limit(1);
		await deleteEmulatorRank(db, ctx.data.id);
		if (role) {
			await db.transaction(async (tx) => {
				await tx
					.delete(AclModelPermission)
					.where(
						and(
							eq(AclModelPermission.modelId, role.id),
							eq(AclModelPermission.modelType, "Role"),
						),
					);
				await tx.delete(AclModelRole).where(eq(AclModelRole.roleId, role.id));
				await tx.delete(AclRole).where(eq(AclRole.id, role.id));
			});
		}
		await logStaffActivity({
			staffId: ctx.session.user.id,
			action: "rank_delete",
			description: `Deleted rank #${ctx.data.id}`,
			targetType: "rank",
			targetId: ctx.data.id,
		});
		await rcon.send("updatepermissions");
		revalidateTag("permissions", { expire: 0 });
		return actionOk();
	},
);

const saveRankSchema = z.object({
	id: z.coerce.number().int().positive(),
	fields: z.record(z.string(), z.union([z.string(), z.number()])),
});

export const saveRank = adminAction(
	{ schema: saveRankSchema, permission: PERMS.PERMISSIONS_MANAGE },
	async (ctx) => {
		await updateEmulatorRank(db, ctx.data.id, ctx.data.fields);
		if (typeof ctx.data.fields.rank_name === "string") {
			await db
				.update(AclRole)
				.set({ title: ctx.data.fields.rank_name })
				.where(eq(AclRole.slug, `rank_${ctx.data.id}`));
		}
		await logStaffActivity({
			staffId: ctx.session.user.id,
			action: "rank_update",
			description: `Updated rank #${ctx.data.id}`,
			targetType: "rank",
			targetId: ctx.data.id,
		});
		await rcon.send("updatepermissions");
		revalidateTag("permissions", { expire: 0 });
		return actionOk();
	},
);

const setCmsPermsSchema = z.object({
	roleId: z.coerce.number().int().positive(),
	permissionSlugs: z.array(z.string().trim().min(1)).max(500),
});

export const setCmsPermissions = adminAction(
	{ schema: setCmsPermsSchema, permission: PERMS.PERMISSIONS_MANAGE },
	async (ctx) => {
		const [role] = await db
			.select({ id: AclRole.id, slug: AclRole.slug })
			.from(AclRole)
			.where(eq(AclRole.id, ctx.data.roleId))
			.limit(1);
		if (!role) throw new ActionError("Role not found");
		const permissions = await db
			.select({ id: AclPermission.id })
			.from(AclPermission)
			.where(inArray(AclPermission.slug, ctx.data.permissionSlugs));
		await db.transaction(async (tx) => {
			await tx
				.delete(AclModelPermission)
				.where(
					and(
						eq(AclModelPermission.modelId, role.id),
						eq(AclModelPermission.modelType, "Role"),
					),
				);
			if (permissions.length) {
				await tx.insert(AclModelPermission).values(
					permissions.map((permission) => ({
						modelId: role.id,
						modelType: "Role",
						permissionId: permission.id,
					})),
				);
			}
		});
		await logStaffActivity({
			staffId: ctx.session.user.id,
			action: "acl_role_permissions_update",
			description: `Updated ${permissions.length} permissions for ${role.slug}`,
			targetType: "acl_role",
			targetId: role.id,
		});
		revalidateTag("permissions", { expire: 0 });
		return actionOk();
	},
);

/**
 * Re-apply the grant repair from migration 0018/0034:
 * - ranks with admin.dashboard get all admin.*.view (read-only: the sidebar
 *   needs to open, nothing more — a blanket `admin.%` grant here is what
 *   promoted rank 6 to full admin)
 * - ranks >= 6 get admin.*.view + dashboard
 * - ranks >= 7 get edit/manage/execute tools used by the sidebar
 */
export const repairAdminNavAclGrants = adminAction(
	{ permission: PERMS.PERMISSIONS_MANAGE },
	async (ctx) => {
		const [dashboardFillResult] = await db.execute(sql`
			INSERT INTO \`acl_model_permissions\` (\`model_type\`, \`model_id\`, \`permission_id\`)
			SELECT 'Role', ar.id, ap.id
			FROM \`acl_roles\` ar
			-- View slugs only: widening this to all admin.* turned "can open the
			-- panel" into "is a full admin" for every mid rank (see 0034).
			JOIN \`acl_permissions\` ap ON ap.slug LIKE 'admin.%' AND ap.slug LIKE '%.view'
			WHERE EXISTS (
			  SELECT 1
			  FROM \`acl_model_permissions\` amp
			  JOIN \`acl_permissions\` apdash ON apdash.id = amp.permission_id
			  WHERE amp.model_type = 'Role'
			    AND amp.model_id = ar.id
			    AND apdash.slug = 'admin.dashboard'
			)
			AND NOT EXISTS (
			  SELECT 1
			  FROM \`acl_model_permissions\` amp2
			  WHERE amp2.model_type = 'Role'
			    AND amp2.model_id = ar.id
			    AND amp2.permission_id = ap.id
			)
		`);

		const [midRankViewsResult] = await db.execute(sql`
			INSERT INTO \`acl_model_permissions\` (\`model_type\`, \`model_id\`, \`permission_id\`)
			SELECT 'Role', ar.id, ap.id
			FROM \`permission_ranks\` pr
			JOIN \`acl_roles\` ar ON ar.slug = CONCAT('rank_', pr.id)
			JOIN \`acl_permissions\` ap ON (
			  ap.slug = 'admin.dashboard'
			  OR (ap.slug LIKE 'admin.%' AND ap.slug LIKE '%.view')
			)
			WHERE pr.id >= 6
			AND NOT EXISTS (
			  SELECT 1
			  FROM \`acl_model_permissions\` amp
			  WHERE amp.model_type = 'Role'
			    AND amp.model_id = ar.id
			    AND amp.permission_id = ap.id
			)
		`);

		const [highRankToolsResult] = await db.execute(sql`
			INSERT INTO \`acl_model_permissions\` (\`model_type\`, \`model_id\`, \`permission_id\`)
			SELECT 'Role', ar.id, ap.id
			FROM \`permission_ranks\` pr
			JOIN \`acl_roles\` ar ON ar.slug = CONCAT('rank_', pr.id)
			JOIN \`acl_permissions\` ap ON (
			  (ap.slug LIKE 'admin.%' AND ap.slug LIKE '%.edit')
			  OR ap.slug IN (
			    'admin.permissions.manage',
			    'admin.rcon.execute',
			    'admin.assets.import',
			    'admin.export',
			    'admin.analytics.export',
			    'admin.users.ban',
			    'admin.users.reset_password',
			    'admin.room.delete'
			  )
			)
			WHERE pr.id >= 7
			AND NOT EXISTS (
			  SELECT 1
			  FROM \`acl_model_permissions\` amp
			  WHERE amp.model_type = 'Role'
			    AND amp.model_id = ar.id
			    AND amp.permission_id = ap.id
			)
		`);

		const inserted =
			Number(dashboardFillResult.affectedRows) +
			Number(midRankViewsResult.affectedRows) +
			Number(highRankToolsResult.affectedRows);

		await logStaffActivity({
			staffId: ctx.session.user.id,
			action: "acl_nav_grants_repair",
			description: `Repaired admin nav ACL grants (${inserted} rows inserted)`,
			targetType: "acl",
			targetId: 0,
		});
		revalidateTag("permissions", { expire: 0 });
		return actionOk({ inserted });
	},
);
