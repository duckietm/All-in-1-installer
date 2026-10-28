import type { HousekeepingDomainId } from "../../migration/types";
import type { CapabilityRequirement } from "./capability";
import type { HousekeepingInboxSource } from "./inbox";
import type { HousekeepingSearchProvider } from "./search";
import type { HousekeepingWidgetDefinition } from "./widget";

export interface HousekeepingRouteDefinition {
	id: string;
	labelKey: string;
	href: string;
	capability: CapabilityRequirement;
	matchPrefixes?: readonly string[];
}

export interface HousekeepingDomainManifest {
	id: HousekeepingDomainId;
	labelKey: string;
	descriptionKey: string;
	iconId: "inbox" | "users" | "file-text" | "gem" | "hotel" | "settings";
	previewHref: `/admin-next/${HousekeepingDomainId}`;
	capability: CapabilityRequirement;
	routes: readonly HousekeepingRouteDefinition[];
	searchProviders: readonly HousekeepingSearchProvider[];
	inboxSources: readonly HousekeepingInboxSource[];
	widgets: readonly HousekeepingWidgetDefinition[];
}
