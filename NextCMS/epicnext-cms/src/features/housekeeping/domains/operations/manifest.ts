import { PERMS } from "@/lib/permission-slugs";
import {
	anyCapability,
	type HousekeepingDomainManifest,
} from "../../foundation/contracts";

export const operationsManifest = {
	id: "operations",
	labelKey: "pages.housekeeping.domains.operations.title",
	descriptionKey: "pages.housekeeping.domains.operations.description",
	iconId: "inbox",
	previewHref: "/admin-next/operations",
	capability: anyCapability(PERMS.ADMIN_DASHBOARD, PERMS.ASSETS_IMPORT),
	routes: [],
	searchProviders: [],
	inboxSources: [],
	widgets: [],
} satisfies HousekeepingDomainManifest;
