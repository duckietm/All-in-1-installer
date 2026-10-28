"use client";
import { useTranslations } from "next-intl";
import { CatalogExportClient } from "@/app/admin/studio/sync/catalog-export-client";
import Link from "@/components/link";
import { refreshCatalogTree } from "@/features/catalog/client/use-live-catalog";
import { FurnitureJobHistory } from "./studio/furniture-jobs";
import { useFurnitureJobs } from "./studio/use-furniture-jobs";
export function OperationsCenter() {
	const t = useTranslations("pages.admin.operationsCenter");
	// Keep the live catalog in step with imports that finish while this tab is open.
	const jobs = useFurnitureJobs(() => void refreshCatalogTree(), true);
	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">{t("title")}</h1>
			<p className="text-[var(--admin-text-muted)]">{t("hint")}</p>
			<FurnitureJobHistory state={jobs} expanded />
			<CatalogExportClient monitorOnly />
			<section className="admin-card space-y-3">
				<h2 className="text-lg font-semibold">{t("syncTitle")}</h2>
				<p>{t("syncHint")}</p>
				<Link href="/admin/studio/sync" className="btn btn-outline">
					{t("openSync")}
				</Link>
				<Link href="/admin/studio/furni" className="btn btn-outline">
					{t("openImports")}
				</Link>
			</section>
		</div>
	);
}
