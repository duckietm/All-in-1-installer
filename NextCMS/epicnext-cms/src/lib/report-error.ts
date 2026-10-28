import { logger } from "@/lib/logger";

/**
 * Log unexpected errors through the structured application logger.
 * Domain errors (validation, auth, etc.) should NOT go through here.
 */
export function reportError(error: unknown, context = "Unhandled error"): void {
	logger.error(context, {
		err: error,
		name: error instanceof Error ? error.name : undefined,
	});
}
