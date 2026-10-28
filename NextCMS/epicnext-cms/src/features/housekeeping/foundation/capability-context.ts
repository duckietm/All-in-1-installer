import type { PermissionSet } from "@/lib/permissions";
import type {
	CapabilityRequirement,
	HousekeepingActor,
	HousekeepingCapabilityContext,
} from "./contracts";

export function createHousekeepingCapabilityContext(
	actor: HousekeepingActor,
	permissions: PermissionSet,
): HousekeepingCapabilityContext {
	return {
		actor,
		isSuperAdmin: permissions.isSuperAdmin,
		has: (slug) => permissions.has(slug),
		hasAny: (...slugs) => permissions.hasAny(...slugs),
		hasAll: (...slugs) => permissions.hasAll(...slugs),
	};
}

export function satisfiesCapability(
	context: HousekeepingCapabilityContext,
	requirement: CapabilityRequirement,
): boolean {
	if (context.isSuperAdmin) return true;

	return requirement.mode === "any"
		? context.hasAny(...requirement.slugs)
		: context.hasAll(...requirement.slugs);
}
