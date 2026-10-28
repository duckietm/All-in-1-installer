import { RefreshCw } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { OfficialSyncClient } from "@/app/admin/import/official/official-sync-client";
import { SyncAllClient } from "@/app/admin/import/sync/sync-all-client";
import { StudioPage } from "@/components/admin/studio/studio-page";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

import { CatalogExportClient } from "./catalog-export-client";

export default async function StudioSyncPage(_props: {
	params: Promise<{ locale: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ASSETS_IMPORT, session.user.rank)) {
		redirect("/admin");
	}
	const t = await getTranslations("admin.studio");
	return (
		<StudioPage
			icon={RefreshCw}
			title={t("nav.syncRepository")}
			subtitle={t("sync.pageSubtitle")}
		>
			<div className="space-y-6">
				<CatalogExportClient
					canConfigure={canAccess(
						permissions,
						PERMS.SETTINGS_EDIT,
						session.user.rank,
					)}
				/>

				<section className="space-y-3 rounded-lg border border-[var(--admin-border)] p-4">
					<h2 className="text-lg font-semibold">
						{t("sync.cloneSourcesTitle")}
					</h2>
					<p className="text-sm text-[var(--admin-text-muted)]">
						{t("sync.cloneSourcesBody")}
					</p>
					<SyncAllClient />
				</section>

				<section className="space-y-3 rounded-lg border border-[var(--admin-border)] p-4">
					<h2 className="text-lg font-semibold">
						{t("sync.officialFurnidataTitle")}
					</h2>
					<p className="text-sm text-[var(--admin-text-muted)]">
						{t("sync.officialFurnidataBody")}
					</p>
					<OfficialSyncClient />
				</section>
			</div>
		</StudioPage>
	);
}
