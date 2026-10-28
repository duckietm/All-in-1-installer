import { Shirt } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ImportClothingClient } from "@/app/admin/import/clothing/import-clothing-client";
import { StudioPage } from "@/components/admin/studio/studio-page";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function StudioClothingPage(_props: {
	params: Promise<{ locale: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ASSETS_IMPORT, session.user.rank)) {
		redirect("/admin");
	}
	const t = await getTranslations("admin.studio");
	return (
		<StudioPage
			icon={Shirt}
			title={t("nav.clothing")}
			subtitle={t("pages.clothingSubtitle")}
		>
			<ImportClothingClient />
		</StudioPage>
	);
}
