import type { SourceFurni } from "@/lib/services/clone-import";
export const IMPORT_PHASES = [
	"validating",
	"downloading",
	"converting",
	"checking_sources",
	"writing_db",
	"writing_furnidata",
	"translating",
] as const;
export type ImportPhase = (typeof IMPORT_PHASES)[number];
export interface ImportJobItem {
	id: number;
	classname: string;
	name: string;
	description: string;
	type: string;
	revision: number;
	category: string;
	attachmentId?: string;
	cloneSourceId?: string;
	cloneEntry?: SourceFurni;
}
export interface ImportJob {
	mode?: "repair";
	syncKind?: "official" | "clone";
	operationId?: string;
	requestFingerprint?: string;
	retryOf?: string;
	id: string;
	userId: number;
	createdAt: string;
	updatedAt: string;
	state: "queued" | "running" | "completed" | "interrupted" | "cancelled";
	cancelRequested?: boolean;
	sourceId?: string;
	translate: boolean;
	langs?: string[];
	items: Array<
		ImportJobItem & {
			state:
				| "pending"
				| "running"
				| "done"
				| "failed"
				| "cancelled"
				| "interrupted";
			phase?: ImportPhase;
			phaseStartedAt?: string;
			sourceAttempt?: string;
			recoveredSource?: {
				sourceId: string;
				sourceName: string;
				revision: number;
			};
			error?: string;
			warnings?: string[];
			itemId?: number;
		}
	>;
}
