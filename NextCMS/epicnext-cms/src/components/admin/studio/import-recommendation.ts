import { furnitureCompleteness } from "@/lib/furni/studio-completeness";
import type { FurnitureInspection } from "@/lib/furni/studio-inspection";
export function importRecommendation(local: FurnitureInspection) {
	const parts = furnitureCompleteness(local);
	const missing = parts
		.filter((part) => part.status === "missing")
		.map((part) => part.id);
	const unknown = parts
		.filter((part) => part.status === "unknown")
		.map((part) => part.id);
	const action = parts.some((part) => part.status === "conflict")
		? "conflict"
		: unknown.length
			? "verify"
			: missing.length === parts.length
				? "import"
				: missing.length
					? "complete"
					: "refresh";
	return { action, missing, unknown } as const;
}
