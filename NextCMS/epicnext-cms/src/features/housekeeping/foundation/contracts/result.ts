export type HousekeepingErrorCode =
	| "VALIDATION_FAILED"
	| "AUTHENTICATION_REQUIRED"
	| "CAPABILITY_DENIED"
	| "NOT_FOUND"
	| "CONFLICT"
	| "DEPENDENCY_UNAVAILABLE"
	| "PARTIAL_RESULT"
	| "INTERNAL_ERROR";

export type HousekeepingResult<T> =
	| { ok: true; data: T; correlationId: string }
	| {
			ok: false;
			error: { code: HousekeepingErrorCode };
			correlationId: string;
	  };

export function ok<T>(data: T, correlationId: string): HousekeepingResult<T> {
	return { ok: true, data, correlationId };
}

export function fail(
	code: HousekeepingErrorCode,
	correlationId: string,
): HousekeepingResult<never> {
	return { ok: false, error: { code }, correlationId };
}
