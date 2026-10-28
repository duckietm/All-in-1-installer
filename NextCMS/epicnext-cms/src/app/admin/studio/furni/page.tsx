import { redirect } from "next/navigation";
import { StudioClient } from "@/components/admin/studio/studio-client";
import { buildFurniImportSource } from "@/lib/habbo-gamedata-hotel";
import { canAccess, getAdminContext, PERMS } from "@/lib/permissions";
import { getHabboGamedataHotel } from "@/lib/services/habbo-gamedata-hotel";
import { siteSettings } from "@/lib/services/site-settings";

export default async function StudioFurniPage(_props: {
	params: Promise<{ locale: string }>;
}) {
	const { session, permissions } = await getAdminContext();
	if (!canAccess(permissions, PERMS.ASSETS_IMPORT, session.user.rank)) {
		redirect("/admin");
	}

	// The catalog tree is not read here: StudioClient pulls it from the live
	// catalog store, which an import updates in place instead of forcing a
	// route re-render.
	const [hotel, translateEnabled] = await Promise.all([
		getHabboGamedataHotel(),
		siteSettings.getBool("furnidata_translate_enabled", true),
	]);

	return (
		<StudioClient
			actorId={Number(session.user.id)}
			source={buildFurniImportSource(hotel)}
			defaultTranslate={translateEnabled}
		/>
	);
}
