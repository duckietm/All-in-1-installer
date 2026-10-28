import type { HousekeepingDomainId } from "../../migration/types";
import type {
	CapabilityRequirement,
	HousekeepingCapabilityContext,
} from "./capability";
import type { HousekeepingResult } from "./result";

export type HousekeepingWorkItemSeverity = "info" | "warning" | "critical";
export type HousekeepingWorkItemFreshness = "fresh" | "stale";
export type HousekeepingInboxSourceAvailability = "available" | "unavailable";

export interface HousekeepingWorkItem {
	sourceId: string;
	itemId: string;
	deduplicationKey: string;
	domain: HousekeepingDomainId;
	capability: CapabilityRequirement;
	severity: HousekeepingWorkItemSeverity;
	occurredAt: string;
	titleKey: string;
	context?: Readonly<Record<string, unknown>>;
	href: string;
	freshness: HousekeepingWorkItemFreshness;
}

export interface HousekeepingInboxSourceResult {
	items: readonly HousekeepingWorkItem[];
	availability: HousekeepingInboxSourceAvailability;
}

export interface HousekeepingInboxSource {
	id: string;
	owner: HousekeepingDomainId;
	capability: CapabilityRequirement;
	getItems(
		context: HousekeepingCapabilityContext,
		signal: AbortSignal,
	): Promise<HousekeepingResult<HousekeepingInboxSourceResult>>;
}
