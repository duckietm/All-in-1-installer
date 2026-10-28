import { PERMS } from "@/lib/permission-slugs";
import {
	anyCapability,
	type HousekeepingDomainManifest,
} from "../../foundation/contracts";

export const economyManifest = {
	id: "economy",
	labelKey: "pages.housekeeping.domains.economy.title",
	descriptionKey: "pages.housekeeping.domains.economy.description",
	iconId: "gem",
	previewHref: "/admin-next/economy",
	capability: anyCapability(
		PERMS.CATALOG_VIEW,
		PERMS.SHOP_VIEW,
		PERMS.CATALOG_EDIT,
		PERMS.SHOP_EDIT,
		PERMS.REFERRALS_VIEW,
		PERMS.REFERRALS_EDIT,
		PERMS.DAILY_REWARDS_VIEW,
		PERMS.DAILY_REWARDS_EDIT,
	),
	routes: [],
	searchProviders: [],
	inboxSources: [],
	widgets: [],
} satisfies HousekeepingDomainManifest;
