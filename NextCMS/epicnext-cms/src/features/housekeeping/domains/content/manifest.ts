import { PERMS } from "@/lib/permission-slugs";
import {
	anyCapability,
	type HousekeepingDomainManifest,
} from "../../foundation/contracts";

export const contentManifest = {
	id: "content",
	labelKey: "pages.housekeeping.domains.content.title",
	descriptionKey: "pages.housekeeping.domains.content.description",
	iconId: "file-text",
	previewHref: "/admin-next/content",
	capability: anyCapability(
		PERMS.NEWS_VIEW,
		PERMS.PAGES_VIEW,
		PERMS.BANNERS_VIEW,
		PERMS.EVENTS_VIEW,
		PERMS.POLLS_VIEW,
		PERMS.PREFIXES_VIEW,
		PERMS.NEWS_EDIT,
		PERMS.PAGES_EDIT,
		PERMS.BANNERS_EDIT,
		PERMS.EVENTS_EDIT,
		PERMS.POLLS_EDIT,
		PERMS.PREFIXES_EDIT,
		PERMS.SETTINGS_VIEW,
		PERMS.SETTINGS_EDIT,
	),
	routes: [],
	searchProviders: [],
	inboxSources: [],
	widgets: [],
} satisfies HousekeepingDomainManifest;
