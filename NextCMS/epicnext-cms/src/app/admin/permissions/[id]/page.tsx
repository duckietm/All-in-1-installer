import { asc, count, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { AdminBreadcrumb } from "@/components/admin/admin-breadcrumb";
import { AclModelPermission, AclPermission, AclRole, db, User } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { fetchEmulatorRankForEdit } from "@/lib/services/permission-ranks";
import { RankEditClient } from "./rank-edit-client";

export default async function RankEditPage({
	params,
}: {
	params: Promise<{ locale: string; id: string }>;
}) {
	const { id: rawId } = await params;
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.PERMISSIONS_MANAGE, session.user.rank)) {
		redirect("/admin");
	}

	const rankId = parseInt(rawId, 10);
	if (Number.isNaN(rankId)) notFound();

	const rank = await fetchEmulatorRankForEdit(db, rankId);
	if (!rank) notFound();

	// Fetch users with this rank (limit 200)
	const users = await db
		.select({ id: User.id, username: User.username, look: User.look })
		.from(User)
		.where(eq(User.rank, rankId))
		.orderBy(asc(User.username))
		.limit(200);

	const [totalUsersRow] = await db
		.select({ total: count() })
		.from(User)
		.where(eq(User.rank, rankId));
	const totalUsers = totalUsersRow?.total ?? 0;

	// Fetch all CMS permissions
	const allCmsPermissions = await db
		.select({
			id: AclPermission.id,
			slug: AclPermission.slug,
			title: AclPermission.title,
		})
		.from(AclPermission)
		.orderBy(asc(AclPermission.slug));

	// Auto-create CMS role for rank >= 4
	let cmsRole: {
		id: number;
		slug: string;
		title: string;
		permissionSlugs: string[];
	} | null = null;

	if (rankId >= 4) {
		const slug = `rank_${rankId}`;
		const title = rank.rank_name || `Rank ${rankId}`;
		const [existing] = await db
			.select({ id: AclRole.id })
			.from(AclRole)
			.where(eq(AclRole.slug, slug))
			.limit(1);

		let roleId: number;
		if (existing) {
			roleId = existing.id;
			await db.update(AclRole).set({ title }).where(eq(AclRole.id, roleId));
		} else {
			const inserted = await db.insert(AclRole).values({ slug, title });
			roleId = inserted[0].insertId;
		}

		const permissionRows = await db
			.select({ slug: AclPermission.slug })
			.from(AclModelPermission)
			.innerJoin(
				AclPermission,
				eq(AclModelPermission.permissionId, AclPermission.id),
			)
			.where(eq(AclModelPermission.modelId, roleId));

		cmsRole = {
			id: roleId,
			slug,
			title,
			permissionSlugs: permissionRows.map((rp) => rp.slug),
		};
	}

	return (
		<div className="space-y-6">
			<AdminBreadcrumb
				items={[
					{ label: "Permissions", href: "/admin/permissions" },
					{ label: rank.rank_name || `Rank ${rankId}` },
				]}
			/>
			<RankEditClient
				rank={rank}
				users={users}
				totalUsers={totalUsers}
				cmsRole={cmsRole}
				allCmsPermissions={allCmsPermissions}
			/>
		</div>
	);
}
