import { env } from "@/env";

/** Hard floor/ceiling so a bad env value can never lock accounts out. */
const ABSOLUTE_MIN_LENGTH = 5;
const ABSOLUTE_MAX_LENGTH = 128;

function toLength(value: unknown, fallback: number): number {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

/**
 * Effective password-length policy. `PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH`
 * drive the bounds; the values are clamped to a sane window so a typo in the env
 * can neither accept empty passwords nor reject every possible one.
 */
export const passwordPolicy = (() => {
	const minLength = Math.min(
		ABSOLUTE_MAX_LENGTH,
		Math.max(ABSOLUTE_MIN_LENGTH, toLength(env.PASSWORD_MIN_LENGTH, 12)),
	);
	const maxLength = Math.max(
		minLength,
		Math.min(ABSOLUTE_MAX_LENGTH, toLength(env.PASSWORD_MAX_LENGTH, 128)),
	);
	return { minLength, maxLength };
})();
