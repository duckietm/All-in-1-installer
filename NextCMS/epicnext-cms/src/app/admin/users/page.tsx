import { and, desc, eq, gte, like, or } from "drizzle-orm";
import { Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { fetchAdminList } from "@/lib/admin-list";
import { db, User } from "@/lib/db";
import { formatNumber } from "@/lib/format-date";
import { canAccess, PERMS } from "@/lib/permissions";
import { getCachedAdminCount } from "@/lib/services/admin-stats";
import { CreateUserDialog } from "./_components/create-user-dialog";
import { UsersTable } from "./users-table";

export default async function UsersPage({
	params: paramsPromise,
	searchParams,
}: {
	params: Promise<{ locale: string }>;
	searchParams: Promise<Record<string, string>>;
}) {
	const result = await fetchAdminList(
		{
			permission: PERMS.USERS_VIEW,
			fetch: async ({ search, page, perPage, rawParams }) => {
				const conditions = [];
				if (search) {
					const ors = [
						like(User.username, `%${search}%`),
						like(User.mail, `%${search}%`),
						like(User.ipRegister, `%${search}%`),
						like(User.ipCurrent, `%${search}%`),
					];
					const asId = Number(search);
					if (Number.isFinite(asId) && asId > 0) {
						ors.push(eq(User.id, asId));
					}
					conditions.push(or(...ors));
				}
				const rank = Number(rawParams.filter_rank);
				if (Number.isFinite(rank)) {
					// For rank 7 the preset means "super admins" — match ≥ 7 instead of equals.
					conditions.push(rank >= 7 ? gte(User.rank, 7) : eq(User.rank, rank));
				}
				if (rawParams.filter_online) {
					conditions.push(eq(User.online, rawParams.filter_online));
				}
				const where = conditions.length > 0 ? and(...conditions) : undefined;
				const [rows, total] = await Promise.all([
					db
						.select({
							id: User.id,
							username: User.username,
							mail: User.mail,
							rank: User.rank,
							credits: User.credits,
							pixels: User.pixels,
							online: User.online,
							motto: User.motto,
							look: User.look,
							ipRegister: User.ipRegister,
							accountCreated: User.accountCreated,
							lastLogin: User.lastLogin,
						})
						.from(User)
						.where(where)
						.orderBy(desc(User.id))
						.limit(perPage)
						.offset((page - 1) * perPage),
					getCachedAdminCount(User, "users:total", where),
				]);
				return { rows, total };
			},
		},
		paramsPromise,
		searchParams,
	);

	const t = await getTranslations("pages.admin.users");
	const canEdit = canAccess(result.permissions, PERMS.USERS_EDIT, result.rank);
	const canBan = canAccess(result.permissions, PERMS.USERS_BAN, result.rank);

	return (
		<AdminPageShell
			icon={Users}
			title={t("title")}
			subtitle={t("subtitle")}
			actions={
				canEdit ? <CreateUserDialog sessionRank={result.rank} /> : undefined
			}
		>
			<p className="text-muted-foreground m-0">
				{formatNumber(result.total)} users total
			</p>

			<UsersTable
				data={{
					rows: result.rows,
					total: result.total,
					page: result.page,
					perPage: result.perPage,
					lastPage: result.lastPage,
				}}
				canEdit={canEdit}
				canBan={canBan}
			/>
		</AdminPageShell>
	);
}
