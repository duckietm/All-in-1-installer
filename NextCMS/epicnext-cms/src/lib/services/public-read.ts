import "server-only";
import { logger } from "@/lib/logger";

/** Keep failed public reads distinct from valid empty collections and zero counts. */
export function publicReadFailure(section: string) {
	return (error: unknown): null => {
		logger.error("Public section query failed", {
			module: "public-data",
			section,
			error,
		});
		return null;
	};
}
