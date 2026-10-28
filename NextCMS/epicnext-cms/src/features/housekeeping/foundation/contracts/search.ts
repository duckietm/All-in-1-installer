import type { HousekeepingDomainId } from "../../migration/types";
import type {
	CapabilityRequirement,
	HousekeepingCapabilityContext,
} from "./capability";
import type { HousekeepingResult } from "./result";

export interface HousekeepingSearchInput {
	term: string;
	limit: number;
}

export interface HousekeepingSearchResult {
	id: string;
	domain: HousekeepingDomainId;
	title: string;
	href: string;
}

export interface HousekeepingSearchProvider {
	id: string;
	owner: HousekeepingDomainId;
	capability: CapabilityRequirement;
	search(
		context: HousekeepingCapabilityContext,
		input: HousekeepingSearchInput,
	): Promise<HousekeepingResult<readonly HousekeepingSearchResult[]>>;
}
