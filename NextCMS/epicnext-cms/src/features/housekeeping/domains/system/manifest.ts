import { PERMS } from "@/lib/permission-slugs";
import {
	anyCapability,
	type HousekeepingDomainManifest,
} from "../../foundation/contracts";

export const systemManifest = {
	id: "system",
	labelKey: "pages.housekeeping.domains.system.title",
	descriptionKey: "pages.housekeeping.domains.system.description",
	iconId: "settings",
	previewHref: "/admin-next/system",
	capability: anyCapability(
		PERMS.SETTINGS_VIEW,
		PERMS.LOGS_VIEW,
		PERMS.ANALYTICS_VIEW,
		PERMS.DEVOPS_VIEW,
		PERMS.DEVOPS_EDIT,
		PERMS.NOTIFICATIONS_VIEW,
		PERMS.PERMISSIONS_MANAGE,
		PERMS.RCON_EXECUTE,
		PERMS.SETTINGS_EDIT,
		PERMS.NOTIFICATIONS_EDIT,
	),
	routes: [],
	searchProviders: [],
	inboxSources: [],
	widgets: [],
} satisfies HousekeepingDomainManifest;
