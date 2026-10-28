import { Copy } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ImportCloneClient } from "@/app/admin/import/clone/import-clone-client";
import { StudioPage } from "@/components/admin/studio/studio-page";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";

export default async function StudioClonePage(_props: {
	params: Promise<{ locale: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ASSETS_IMPORT, session.user.rank)) {
		redirect("/admin");
	}
	const t = await getTranslations("admin.studio");
	return (
		<StudioPage
			icon={Copy}
			title={t("nav.importFromSource")}
			subtitle={t("pages.cloneSubtitle")}
		>
			<ImportCloneClient />
		</StudioPage>
	);
}
