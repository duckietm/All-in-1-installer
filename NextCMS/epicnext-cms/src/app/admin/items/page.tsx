import { and, desc, eq, like, or } from "drizzle-orm";
import { Package } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { fetchAdminList } from "@/lib/admin-list";
import { db, ItemsBase } from "@/lib/db";
import { canAccess, PERMS } from "@/lib/permissions";
import { getCachedAdminCount } from "@/lib/services/admin-stats";
import { type ItemsBaseRow, ItemsTable } from "./items-table";

export default async function ItemsBasePage({
	params: paramsPromise,
	searchParams,
}: {
	params: Promise<{ locale: string }>;
	searchParams: Promise<Record<string, string>>;
}) {
	const result = await fetchAdminList<ItemsBaseRow>(
		{
			permission: PERMS.CATALOG_VIEW,
			fetch: async ({ search, page, perPage, rawParams }) => {
				const conditions = [];
				if (search) {
					const ors = [
						like(ItemsBase.itemName, `%${search}%`),
						like(ItemsBase.publicName, `%${search}%`),
					];
					const asId = Number(search);
					if (Number.isFinite(asId) && asId > 0) {
						ors.push(eq(ItemsBase.id, asId));
					}
					conditions.push(or(...ors));
				}
				if (rawParams.filter_type) {
					conditions.push(eq(ItemsBase.type, rawParams.filter_type));
				}
				const where = conditions.length > 0 ? and(...conditions) : undefined;
				const [rows, total] = await Promise.all([
					db
						.select({
							id: ItemsBase.id,
							spriteId: ItemsBase.spriteId,
							publicName: ItemsBase.publicName,
							itemName: ItemsBase.itemName,
							type: ItemsBase.type,
							interactionType: ItemsBase.interactionType,
							width: ItemsBase.width,
							length: ItemsBase.length,
						})
						.from(ItemsBase)
						.where(where)
						.orderBy(desc(ItemsBase.id))
						.limit(perPage)
						.offset((page - 1) * perPage),
					getCachedAdminCount(ItemsBase, "items_base", where),
				]);
				return {
					rows: rows.map((r) => ({
						id: r.id,
						spriteId: r.spriteId,
						publicName: r.publicName || "",
						itemName: r.itemName || "",
						type: r.type || "s",
						interactionType: r.interactionType || "default",
						width: r.width,
						length: r.length,
					})),
					total,
				};
			},
		},
		paramsPromise,
		searchParams,
	);

	const t = await getTranslations("pages.admin.items");
	const canEdit = canAccess(
		result.permissions,
		PERMS.CATALOG_EDIT,
		result.rank,
	);

	return (
		<AdminPageShell icon={Package} title={t("title")} subtitle={t("subtitle")}>
			<p className="text-muted-foreground m-0">
				{t("total", { count: result.total })}
			</p>
			<ItemsTable
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
