import type { HousekeepingDomainId } from "../../migration/types";
import type {
	CapabilityRequirement,
	HousekeepingCapabilityContext,
} from "./capability";
import type { HousekeepingResult } from "./result";

export type HousekeepingWidgetKind = "mandatory" | "optional";

export interface HousekeepingWidgetDefinition {
	id: string;
	owner: HousekeepingDomainId;
	capability: CapabilityRequirement;
	kind: HousekeepingWidgetKind;
	load(
		context: HousekeepingCapabilityContext,
	): Promise<HousekeepingResult<unknown>>;
}
