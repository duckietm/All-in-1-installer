export const HOUSEKEEPING_DOMAIN_IDS = [
	"operations",
	"people",
	"content",
	"economy",
	"hotel",
	"system",
] as const;

export type HousekeepingDomainId = (typeof HOUSEKEEPING_DOMAIN_IDS)[number];
export type LegacySurface = "admin" | "mod";
export type MigrationDecision = "REHOST" | "REBUILD" | "MERGE" | "REMOVE";
export type AuditRequirement = "NONE" | "MUTATION" | "PRIVILEGED_MUTATION";
export type AuditState = "UNAUDITED" | "PARTIAL" | "COMPLETE";
export type MigrationStatus =
	| "PLANNED"
	| "IN_PROGRESS"
	| "VERIFIED"
	| "REMOVED";

export interface LegacyPage {
	surface: LegacySurface;
	legacyPath: string;
	sourceFile: string;
}

export interface MigrationEntry extends LegacyPage {
	targetDomain: HousekeepingDomainId;
	targetPath: string | null;
	decision: MigrationDecision;
	capabilities: { read: readonly string[]; mutate: readonly string[] };
	dependencies: { queries: readonly string[]; mutations: readonly string[] };
	auditRequirement: AuditRequirement;
	localization: AuditState;
	accessibility: AuditState;
	requiredTests: readonly ("unit" | "integration" | "e2e" | "visual")[];
	parityEvidence: readonly string[];
	status: MigrationStatus;
	notes: readonly string[];
}
