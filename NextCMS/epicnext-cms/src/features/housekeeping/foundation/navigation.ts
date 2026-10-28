import type { HousekeepingDomainId } from "../migration/types";
import { satisfiesCapability } from "./capability-context";
import type {
	HousekeepingCapabilityContext,
	HousekeepingDomainManifest,
} from "./contracts";
import type { HousekeepingRegistry } from "./registry";

export interface HousekeepingNavigationDomain {
	id: HousekeepingDomainId;
	href: string;
	iconId: HousekeepingDomainManifest["iconId"];
	label: string;
	description: string;
	items: readonly { id: string; href: string; label: string }[];
}

export function buildHousekeepingNavigation(
	registry: HousekeepingRegistry,
	context: HousekeepingCapabilityContext,
	translate: (key: string) => string,
): readonly HousekeepingNavigationDomain[] {
	return registry.domains
		.filter((domain) => satisfiesCapability(context, domain.capability))
		.map((domain) => ({
			id: domain.id,
			href: domain.previewHref,
			iconId: domain.iconId,
			label: translate(domain.labelKey),
			description: translate(domain.descriptionKey),
			items: domain.routes
				.filter((route) => satisfiesCapability(context, route.capability))
				.map((route) => ({
					id: route.id,
					href: route.href,
					label: translate(route.labelKey),
				})),
		}));
}
