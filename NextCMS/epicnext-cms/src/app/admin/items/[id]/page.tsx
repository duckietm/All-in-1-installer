import { eq } from "drizzle-orm";
import { Package } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { db, ItemsBase } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { ItemsBaseEditForm } from "./items-base-edit-form";

export default async function ItemsBaseDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.CATALOG_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const t = await getTranslations("pages.admin.items");
	const { id: rawId } = await params;
	const id = Number(rawId);
	if (!Number.isFinite(id) || id <= 0) notFound();

	const [item] = await db
		.select()
		.from(ItemsBase)
		.where(eq(ItemsBase.id, id))
		.limit(1);
	if (!item) notFound();

	const canEdit = canAccess(permissions, PERMS.CATALOG_EDIT, session.user.rank);

	return (
		<AdminPageShell
			icon={Package}
			title={t("editTitle", { name: item.publicName || item.itemName })}
			subtitle={t("editSubtitle", { id: item.id })}
		>
			<ItemsBaseEditForm
				canEdit={canEdit}
				initial={{
					id: item.id,
					spriteId: item.spriteId,
					publicName: item.publicName,
					itemName: item.itemName,
					type: item.type,
					width: item.width,
					length: item.length,
					stackHeight: String(item.stackHeight),
					allowStack: item.allowStack,
					allowSit: item.allowSit,
					allowLay: item.allowLay,
					allowWalk: item.allowWalk,
					allowGift: item.allowGift,
					allowTrade: item.allowTrade,
					allowRecycle: item.allowRecycle,
					allowMarketplaceSell: item.allowMarketplaceSell,
					allowInventoryStack: item.allowInventoryStack,
					interactionType: item.interactionType,
					interactionModesCount: item.interactionModesCount,
					vendingIds: item.vendingIds,
					multiheight: item.multiheight,
					customparams: item.customparams,
				}}
			/>
		</AdminPageShell>
	);
}
