import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { CatalogPagesBc, db } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

async function topAncestorId(parentId: number): Promise<number | null> {
	let current = parentId;
	for (let i = 0; i < 50; i++) {
		if (current <= 0) return null;
		const [page] = await db
			.select({ id: CatalogPagesBc.id, parentId: CatalogPagesBc.parentId })
			.from(CatalogPagesBc)
			.where(eq(CatalogPagesBc.id, current))
			.limit(1);
		if (!page) return null;
		if (page.parentId <= 0) return page.id;
		current = page.parentId;
	}
	return null;
}

export default async function BcPageDetailPage({
	params: paramsPromise,
}: {
	params: Promise<{ locale: string; id: string }>;
}) {
	const { id: idStr } = await paramsPromise;
	const id = parseInt(idStr, 10);
	if (Number.isNaN(id)) notFound();

	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.CATALOG_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const [bcPage] = await db
		.select({ id: CatalogPagesBc.id, parentId: CatalogPagesBc.parentId })
		.from(CatalogPagesBc)
		.where(eq(CatalogPagesBc.id, id))
		.limit(1);
	if (!bcPage) notFound();

	const rootId = (await topAncestorId(bcPage.parentId)) ?? id;
	redirect(`/admin/catalog?catalog=bc&root=${rootId}&category=${id}`);
}
