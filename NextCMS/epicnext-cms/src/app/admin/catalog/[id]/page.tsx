import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { CatalogPages, db } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { getAncestors } from "@/lib/services/catalog-tree";

export default async function CatalogEditPage({
	params,
}: {
	params: Promise<{ locale: string; id: string }>;
}) {
	const { id } = await params;
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.CATALOG_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const pageId = parseInt(id, 10);
	if (Number.isNaN(pageId)) notFound();

	const [catalogPage] = await db
		.select({ id: CatalogPages.id, parentId: CatalogPages.parentId })
		.from(CatalogPages)
		.where(eq(CatalogPages.id, pageId))
		.limit(1);

	if (!catalogPage) notFound();

	const ancestors = await getAncestors(catalogPage.parentId);
	const rootId = ancestors[0]?.id ?? pageId;
	redirect(`/admin/catalog?root=${rootId}&category=${pageId}`);
}
