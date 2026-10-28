import { Image as ImageIcon } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { RepairIconsClient } from "@/app/admin/import/repair-icons/repair-icons-client";
import { StudioPage } from "@/components/admin/studio/studio-page";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function StudioRepairIconsPage(_props: {
	params: Promise<{ locale: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ASSETS_IMPORT, session.user.rank)) {
		redirect("/admin");
	}
	const t = await getTranslations("admin.studio");
	return (
		<StudioPage
			icon={ImageIcon}
			title={t("pages.repairIconsTitle")}
			subtitle={t("pages.repairIconsSubtitle")}
		>
			<RepairIconsClient />
		</StudioPage>
	);
}
