import { ZodError, z } from "zod";
import { handleActionError as foundationHandle } from "@/lib/foundation/action";

export type ActionResult<T = Record<string, unknown>> =
	| { ok: true; data?: T }
	| { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function actionOk<T = Record<string, unknown>>(
	data?: T,
): ActionResult<T> {
	return { ok: true, data: data ?? ({} as T) };
}

export function actionError(message: string): ActionResult<never> {
	return { ok: false, error: message };
}

export class ActionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ActionError";
	}
}

export function handleActionError(error: unknown): ActionResult<never> {
	if (error instanceof ZodError) {
		return {
			ok: false,
			error: "Validation failed",
			fieldErrors: z.flattenError(error).fieldErrors as Record<
				string,
				string[]
			>,
		};
	}
	if (error instanceof Error && error.name === "ActionError") {
		return { ok: false, error: error.message };
	}
	return foundationHandle(error) as ActionResult<never>;
}
