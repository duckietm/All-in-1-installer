import { and, count, desc, eq, like, or, type SQL } from "drizzle-orm";
import { Wifi } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { fetchAdminList } from "@/lib/admin-list";
import { db, User } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { OnlineTable } from "./online-table";

export default async function OnlineUsersPage({
	params: paramsPromise,
	searchParams,
}: {
	params: Promise<{ locale: string }>;
	searchParams: Promise<Record<string, string>>;
}) {
	const result = await fetchAdminList(
		{
			permission: PERMS.USERS_VIEW,
			defaultPerPage: 50,
			fetch: async ({ search, page, perPage }) => {
				const conditions: (SQL | undefined)[] = [eq(User.online, "1")];
				if (search) {
					conditions.push(
						or(
							like(User.username, `%${search}%`),
							like(User.motto, `%${search}%`),
						),
					);
				}
				const where = and(...conditions);
				const [rows, totals] = await Promise.all([
					db
						.select({
							id: User.id,
							username: User.username,
							motto: User.motto,
							look: User.look,
						})
						.from(User)
						.where(where)
						.orderBy(desc(User.id))
						.limit(perPage)
						.offset((page - 1) * perPage),
					db.select({ total: count() }).from(User).where(where),
				]);
				return { rows, total: totals[0]?.total ?? 0 };
			},
		},
		paramsPromise,
		searchParams,
	);

	const t = await getTranslations("pages.admin.online");

	return (
		<AdminPageShell icon={Wifi} title={t("title")} subtitle={t("subtitle")}>
			<p className="text-muted-foreground m-0">
				{t("connected", { count: result.total })}
			</p>

			<OnlineTable
				data={{
					rows: result.rows,
					total: result.total,
					page: result.page,
					perPage: result.perPage,
					lastPage: result.lastPage,
				}}
			/>
		</AdminPageShell>
	);
}
