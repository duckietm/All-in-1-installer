export type CapabilityRequirement =
	| { mode: "all"; slugs: readonly string[] }
	| { mode: "any"; slugs: readonly string[] };

export interface HousekeepingActor {
	id: number;
	username: string;
	rank: number;
}

export interface HousekeepingCapabilityContext {
	actor: HousekeepingActor;
	isSuperAdmin: boolean;
	has(slug: string): boolean;
	hasAny(...slugs: string[]): boolean;
	hasAll(...slugs: string[]): boolean;
}

function createCapabilityRequirement(
	mode: CapabilityRequirement["mode"],
	slugs: readonly string[],
): CapabilityRequirement {
	if (slugs.length === 0) {
		throw new Error("capability requirement is empty");
	}

	return { mode, slugs };
}

export function anyCapability(...slugs: string[]): CapabilityRequirement {
	return createCapabilityRequirement("any", slugs);
}

export function allCapabilities(...slugs: string[]): CapabilityRequirement {
	return createCapabilityRequirement("all", slugs);
}
