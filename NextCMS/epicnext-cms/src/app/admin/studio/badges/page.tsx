import { BadgeCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ImportBadgesClient } from "@/app/admin/import/badges/import-badges-client";
import { StudioPage } from "@/components/admin/studio/studio-page";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function StudioBadgesPage(_props: {
	params: Promise<{ locale: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ASSETS_IMPORT, session.user.rank)) {
		redirect("/admin");
	}
	const t = await getTranslations("admin.studio");
	return (
		<StudioPage
			icon={BadgeCheck}
			title={t("nav.badges")}
			subtitle={t("pages.badgesSubtitle")}
		>
			<ImportBadgesClient />
		</StudioPage>
	);
}
