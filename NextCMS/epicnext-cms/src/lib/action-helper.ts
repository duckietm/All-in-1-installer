import { logger } from "@/lib/logger";

export interface ActionResult<T = void> {
	ok: boolean;
	data?: T;
	error?: string;
}

export async function wrapAction<T>(
	fn: () => Promise<T>,
	actionName: string,
): Promise<ActionResult<T>> {
	try {
		const data = await fn();
		return { ok: true, data };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error";
		logger.error(`Action failed: ${actionName}`, {
			action: actionName,
			error: message,
		});
		return { ok: false, error: message };
	}
}

export function actionError(
	actionName: string,
	message: string,
): ActionResult<never> {
	logger.error(`Action failed: ${actionName}`, {
		action: actionName,
		error: message,
	});
	return { ok: false, error: message };
}
