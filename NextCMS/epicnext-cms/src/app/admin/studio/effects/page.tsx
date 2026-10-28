import { Dumbbell } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ImportEffectsClient } from "@/app/admin/import/effects/import-effects-client";
import { StudioPage } from "@/components/admin/studio/studio-page";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function StudioEffectsPage(_props: {
	params: Promise<{ locale: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ASSETS_IMPORT, session.user.rank)) {
		redirect("/admin");
	}
	const t = await getTranslations("admin.studio");
	return (
		<StudioPage
			icon={Dumbbell}
			title={t("nav.effects")}
			subtitle={t("pages.effectsSubtitle")}
		>
			<ImportEffectsClient />
		</StudioPage>
	);
}
