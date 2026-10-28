import { and, count, desc, eq, like, or } from "drizzle-orm";
import { DoorOpen } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { fetchAdminList } from "@/lib/admin-list";
import { db, Rooms } from "@/lib/db";
import { canAccess, PERMS } from "@/lib/permissions";
import { RoomsTable } from "./rooms-table";

export default async function RoomsPage({
	params: paramsPromise,
	searchParams,
}: {
	params: Promise<{ locale?: string }>;
	searchParams: Promise<Record<string, string>>;
}) {
	const result = await fetchAdminList(
		{
			permission: PERMS.ROOMS_VIEW,
			fetch: async ({ search, page, perPage, rawParams }) => {
				const conditions = [];
				if (search) {
					const ors = [
						like(Rooms.name, `%${search}%`),
						like(Rooms.ownerName, `%${search}%`),
					];
					const asId = Number(search);
					if (Number.isFinite(asId) && asId > 0) {
						ors.push(eq(Rooms.id, asId));
					}
					conditions.push(or(...ors));
				}
				if (rawParams.filter_state) {
					conditions.push(eq(Rooms.state, rawParams.filter_state));
				}
				const where = conditions.length > 0 ? and(...conditions) : undefined;
				const [rows, totals] = await Promise.all([
					db
						.select({
							id: Rooms.id,
							name: Rooms.name,
							ownerId: Rooms.ownerId,
							ownerName: Rooms.ownerName,
							state: Rooms.state,
							users: Rooms.users,
							usersMax: Rooms.usersMax,
							description: Rooms.description,
						})
						.from(Rooms)
						.where(where)
						.orderBy(desc(Rooms.id))
						.limit(perPage)
						.offset((page - 1) * perPage),
					db.select({ total: count() }).from(Rooms).where(where),
				]);
				return {
					rows: rows.map((r) => ({
						id: r.id,
						name: r.name,
						ownerName: r.ownerName || "—",
						ownerId: r.ownerId ?? 0,
						state: r.state,
						users: r.users,
						usersMax: r.usersMax,
						description: r.description || "",
					})),
					total: totals[0]?.total ?? 0,
				};
			},
		},
		paramsPromise as Promise<{ locale: string }>,
		searchParams,
	);

	const t = await getTranslations("pages.admin.rooms");
	const canEdit = canAccess(result.permissions, PERMS.ROOMS_EDIT, result.rank);

	return (
		<AdminPageShell icon={DoorOpen} title={t("title")} subtitle={t("subtitle")}>
			<p className="text-muted-foreground m-0">
				{result.total.toLocaleString()} rooms total
			</p>

			<RoomsTable
				data={{
					rows: result.rows,
					total: result.total,
					page: result.page,
					perPage: result.perPage,
					lastPage: result.lastPage,
				}}
				canEdit={canEdit}
			/>
		</AdminPageShell>
	);
}
