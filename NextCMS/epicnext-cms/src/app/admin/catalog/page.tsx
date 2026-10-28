import { asc, eq, or } from "drizzle-orm";
import { Crown, Store, Wrench } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { OrganizeImportsLauncher } from "@/components/admin/studio/organize-imports-launcher";
import { CatalogSyncStatus } from "@/features/catalog/components/catalog-sync-status";
import { CatalogPackagesDialog } from "@/features/catalog/components/packages/catalog-packages-dialog";
import { getCachedCatalogTotals } from "@/features/catalog/server/catalog-totals";
import { CatalogPages, CatalogPagesBc, db } from "@/lib/db";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import type { RootTab } from "@/types/catalog";
import { CatalogManagerWorkspace } from "./catalog-manager-dialog-wrapper";

async function loadRootPages(catalogType: "normal" | "bc"): Promise<RootTab[]> {
	const pagesTable = catalogType === "bc" ? CatalogPagesBc : CatalogPages;
	const rootRaw = await db
		.select()
		.from(pagesTable)
		.where(or(eq(pagesTable.parentId, -1), eq(pagesTable.parentId, 0)))
		.orderBy(asc(pagesTable.orderNum), asc(pagesTable.id));
	return rootRaw.map((p) => ({
		id: p.id,
		caption: p.caption,
		iconImage: p.iconImage,
		enabled: String(p.enabled),
		orderNum: p.orderNum,
	}));
}

export default async function CatalogPagesPage({
	params: paramsPromise,
	searchParams,
}: {
	params: Promise<{ locale: string }>;
	searchParams: Promise<Record<string, string>>;
}) {
	await paramsPromise;
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.CATALOG_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const canEdit = canAccess(permissions, PERMS.CATALOG_EDIT, session.user.rank);
	const t = await getTranslations("pages.admin.catalog");

	const sp = await searchParams;
	const catalogType = sp.catalog === "bc" ? "bc" : "normal";

	const [totals, rootPages] = await Promise.all([
		getCachedCatalogTotals(catalogType),
		loadRootPages(catalogType),
	]);

	return (
		<AdminPageShell
			icon={Store}
			title={catalogType === "bc" ? "Builder Club Catalog" : t("title")}
			subtitle={t("subtitle")}
			actions={
				<div className="flex flex-wrap items-center gap-2">
					<div className="flex items-center rounded-lg border border-[var(--admin-border)] p-0.5">
						<Link
							href="/admin/catalog"
							className={
								catalogType === "normal"
									? "inline-flex items-center gap-1.5 rounded-md bg-[var(--admin-accent)]/10 px-3 py-1.5 text-sm font-medium text-[var(--admin-text)]"
									: "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
							}
						>
							<Store className="h-3.5 w-3.5" />
							Normal
						</Link>
						<Link
							href="/admin/catalog?catalog=bc"
							className={
								catalogType === "bc"
									? "inline-flex items-center gap-1.5 rounded-md bg-[var(--admin-accent)]/10 px-3 py-1.5 text-sm font-medium text-[var(--admin-text)]"
									: "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
							}
						>
							<Crown className="h-3.5 w-3.5" />
							Builder Club
						</Link>
					</div>
					{catalogType === "normal" && (
						<CatalogPackagesDialog canEdit={canEdit} />
					)}
					<OrganizeImportsLauncher />
					<Link
						className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--admin-border)] px-3 text-sm font-medium text-[var(--admin-text-muted)] hover:bg-[var(--admin-accent)]/10"
						href="/admin/studio/maintenance"
					>
						<Wrench className="h-3.5 w-3.5" />
						{t("workspace.diagnostics")}
					</Link>
				</div>
			}
		>
			<CatalogSyncStatus canEdit={canEdit} />
			<div className="h-[calc(100dvh-13rem)] min-h-[26rem]">
				<CatalogManagerWorkspace
					catalogType={catalogType}
					canEdit={canEdit}
					totals={totals}
					initialRoots={rootPages}
				/>
			</div>
		</AdminPageShell>
	);
}
