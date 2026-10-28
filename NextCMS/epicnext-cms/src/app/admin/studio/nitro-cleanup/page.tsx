import { FileX2 } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { NitroCleanupPanel } from "@/components/admin/studio/nitro-cleanup-panel";
import { StudioPage } from "@/components/admin/studio/studio-page";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function StudioNitroCleanupPage() {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ASSETS_IMPORT, session.user.rank)) {
		redirect("/admin");
	}
	const t = await getTranslations("admin.studio");
	return (
		<StudioPage
			icon={FileX2}
			title={t("nav.nitroCleanup")}
			subtitle={t("pages.nitroCleanupSubtitle")}
		>
			<NitroCleanupPanel />
		</StudioPage>
	);
}
