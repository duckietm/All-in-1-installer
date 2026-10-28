import { PERMS } from "@/lib/permission-slugs";
import {
	anyCapability,
	type HousekeepingDomainManifest,
} from "../../foundation/contracts";

export const hotelManifest = {
	id: "hotel",
	labelKey: "pages.housekeeping.domains.hotel.title",
	descriptionKey: "pages.housekeeping.domains.hotel.description",
	iconId: "hotel",
	previewHref: "/admin-next/hotel",
	capability: anyCapability(
		PERMS.ROOMS_VIEW,
		PERMS.RADIO_VIEW,
		PERMS.ASSETS_IMPORT,
		PERMS.ROOMS_EDIT,
		PERMS.ROOMS_DELETE,
		PERMS.RADIO_EDIT,
		PERMS.PAGES_VIEW,
		PERMS.CATALOG_EDIT,
	),
	routes: [
		{
			id: "theme-manager",
			labelKey: "pages.housekeeping.domains.hotel.routes.themeManager",
			href: "/admin-next/hotel/theme-manager",
			capability: anyCapability(PERMS.SETTINGS_VIEW, PERMS.SETTINGS_EDIT),
		},
		{
			id: "nitro-cleanup",
			labelKey: "pages.housekeeping.domains.hotel.routes.nitroCleanup",
			href: "/admin-next/hotel/nitro-cleanup",
			capability: anyCapability(PERMS.ASSETS_IMPORT),
		},
	],
	searchProviders: [],
	inboxSources: [],
	widgets: [],
} satisfies HousekeepingDomainManifest;
