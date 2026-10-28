import type { HousekeepingDomainId } from "../../migration/types";
import type {
	CapabilityRequirement,
	HousekeepingCapabilityContext,
} from "./capability";
import type { HousekeepingResult } from "./result";

export interface HousekeepingCommand<I, O> {
	id: string;
	owner: HousekeepingDomainId;
	risk: "safe" | "sensitive";
	capability: CapabilityRequirement;
	requiresReason: boolean;
	execute(
		context: HousekeepingCapabilityContext,
		input: I,
	): Promise<HousekeepingResult<O>>;
}
