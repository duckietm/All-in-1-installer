import { Cat } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ImportPetsClient } from "@/app/admin/import/pets/import-pets-client";
import { StudioPage } from "@/components/admin/studio/studio-page";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function StudioPetsPage(_props: {
	params: Promise<{ locale: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ASSETS_IMPORT, session.user.rank)) {
		redirect("/admin");
	}
	const t = await getTranslations("admin.studio");
	return (
		<StudioPage
			icon={Cat}
			title={t("nav.pets")}
			subtitle={t("pages.petsSubtitle")}
		>
			<ImportPetsClient />
		</StudioPage>
	);
}
