import type { HousekeepingDomainId } from "../../migration/types";
import type {
	CapabilityRequirement,
	HousekeepingCapabilityContext,
} from "./capability";
import type { HousekeepingResult } from "./result";

export interface HousekeepingQuery<I, O> {
	id: string;
	owner: HousekeepingDomainId;
	capability: CapabilityRequirement;
	run(
		context: HousekeepingCapabilityContext,
		input: I,
	): Promise<HousekeepingResult<O>>;
}
