import { ClipboardCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuditClient } from "@/app/admin/import/audit/audit-client";
import { StudioPage } from "@/components/admin/studio/studio-page";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function StudioAuditPage(_props: {
	params: Promise<{ locale: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ASSETS_IMPORT, session.user.rank)) {
		redirect("/admin");
	}
	const t = await getTranslations("admin.studio");
	return (
		<StudioPage
			icon={ClipboardCheck}
			title={t("nav.catalogAudit")}
			subtitle={t("pages.auditSubtitle")}
		>
			<AuditClient />
		</StudioPage>
	);
}
