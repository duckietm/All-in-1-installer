import { Wrench } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CatalogIntegrityPanel } from "@/components/admin/catalog/catalog-integrity-panel";
import { CatalogMaintenancePanel } from "@/components/admin/catalog/catalog-maintenance-panel";
import { StudioPage } from "@/components/admin/studio/studio-page";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function StudioCatalogMaintenancePage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.CATALOG_VIEW, session.user.rank)) {
		redirect("/admin");
	}

	const canRepair = canAccess(
		permissions,
		PERMS.CATALOG_EDIT,
		session.user.rank,
	);
	const t = await getTranslations("pages.admin.catalog.integrity");
	const studioT = await getTranslations("admin.studio");
	return (
		<StudioPage
			icon={Wrench}
			title={studioT("nav.catalogMaintenance")}
			subtitle={studioT("pages.maintenanceSubtitle")}
		>
			<div className="min-h-0 space-y-6">
				<CatalogIntegrityPanel canRepair={canRepair} />
				{canRepair && (
					<details className="rounded-xl border p-4">
						<summary className="cursor-pointer font-medium">
							{t("legacyTitle")}
						</summary>
						<p className="mt-3 text-sm text-muted-foreground">
							{t("legacyHint")}
						</p>
						<CatalogMaintenancePanel />
					</details>
				)}
			</div>
		</StudioPage>
	);
}
