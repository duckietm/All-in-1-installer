import { PERMS } from "@/lib/permission-slugs";
import { HOUSEKEEPING_DOMAIN_IDS } from "../migration/types";
import type {
	CapabilityRequirement,
	HousekeepingDomainManifest,
} from "./contracts";

const approvedDomainIds = new Set<string>(HOUSEKEEPING_DOMAIN_IDS);
const knownCapabilitySlugs = new Set<string>(Object.values(PERMS));
interface OwnedRegistryEntry {
	id: string;
	owner: HousekeepingDomainManifest["id"];
	capability: CapabilityRequirement;
}

export interface HousekeepingRegistry {
	domains: readonly HousekeepingDomainManifest[];
}

export function createHousekeepingRegistry(
	manifests: readonly HousekeepingDomainManifest[],
): HousekeepingRegistry {
	const domainIds = new Set<string>();
	const routeIds = new Set<string>();
	const routeHrefs = new Set<string>();
	const registryEntryIds = new Set<string>();

	for (const manifest of manifests) {
		if (!approvedDomainIds.has(manifest.id)) {
			throw new Error(`unknown domain id: ${manifest.id}`);
		}
		if (domainIds.has(manifest.id)) {
			throw new Error(`duplicate domain id: ${manifest.id}`);
		}
		domainIds.add(manifest.id);

		if (manifest.previewHref !== `/admin-next/${manifest.id}`) {
			throw new Error(`invalid preview href: ${manifest.previewHref}`);
		}
		validateNonEmpty(manifest.labelKey, "label key");
		validateNonEmpty(manifest.descriptionKey, "description key");
		validateCapability(manifest.capability);
		validateOwnedRegistryEntries(
			manifest.searchProviders,
			manifest.id,
			"search provider",
			registryEntryIds,
		);
		validateOwnedRegistryEntries(
			manifest.inboxSources,
			manifest.id,
			"inbox source",
			registryEntryIds,
		);
		validateOwnedRegistryEntries(
			manifest.widgets,
			manifest.id,
			"widget",
			registryEntryIds,
		);
		for (const widget of manifest.widgets) {
			if (widget.kind !== "mandatory" && widget.kind !== "optional") {
				throw new Error(`invalid widget kind: ${widget.id}`);
			}
		}

		for (const route of manifest.routes) {
			validateNonEmpty(route.id, "route id");
			if (routeIds.has(route.id)) {
				throw new Error(`duplicate route id: ${route.id}`);
			}
			routeIds.add(route.id);

			validateNonEmpty(route.href, "route href");
			if (routeHrefs.has(route.href)) {
				throw new Error(`duplicate route href: ${route.href}`);
			}
			routeHrefs.add(route.href);

			validateNonEmpty(route.labelKey, "route label key");
			validateCapability(route.capability);
		}
	}

	return { domains: Object.freeze([...manifests]) };
}

function validateOwnedRegistryEntries(
	entries: readonly OwnedRegistryEntry[],
	owner: HousekeepingDomainManifest["id"],
	kind: "search provider" | "inbox source" | "widget",
	ids: Set<string>,
): void {
	for (const entry of entries) {
		validateNonEmpty(entry.id, `${kind} id`);
		if (ids.has(entry.id)) {
			throw new Error(`duplicate ${kind} id: ${entry.id}`);
		}
		ids.add(entry.id);

		if (entry.owner !== owner) {
			throw new Error(`${kind} owner mismatch: ${entry.id}`);
		}

		validateCapability(entry.capability);
	}
}

function validateNonEmpty(value: string, name: string): void {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`empty ${name}`);
	}
}

function validateCapability(requirement: CapabilityRequirement): void {
	if (
		typeof requirement !== "object" ||
		requirement === null ||
		(requirement.mode !== "any" && requirement.mode !== "all") ||
		!Array.isArray(requirement.slugs)
	) {
		throw new Error("invalid capability requirement");
	}

	if (requirement.slugs.length === 0) {
		throw new Error("empty capability requirement");
	}

	for (const slug of requirement.slugs) {
		if (typeof slug !== "string") {
			throw new Error("invalid capability requirement");
		}
		if (!knownCapabilitySlugs.has(slug)) {
			throw new Error(`unknown capability slug: ${slug}`);
		}
	}
}
