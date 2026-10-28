import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isHousekeepingPreviewEnabled } from "./preview-gate";

describe("isHousekeepingPreviewEnabled", () => {
	it.each([
		["development", true, false, true],
		["test", true, false, true],
		["development", false, true, false],
		["production", true, true, true],
		["production", true, false, false],
		["production", false, true, false],
	] as const)(
		"NODE_ENV=%s flag=%s productionAccess=%s => %s",
		(nodeEnv, flag, hasProductionAccess, expected) => {
			expect(
				isHousekeepingPreviewEnabled({
					nodeEnv,
					flag,
					hasProductionAccess,
				}),
			).toBe(expected);
		},
	);
});

describe("HOUSEKEEPING_NEXT_PREVIEW_ENABLED", () => {
	const originalSkipValidation = process.env.SKIP_ENV_VALIDATION;
	const originalPreviewFlag = process.env.HOUSEKEEPING_NEXT_PREVIEW_ENABLED;

	beforeEach(() => {
		vi.resetModules();
		delete process.env.SKIP_ENV_VALIDATION;
	});

	afterEach(() => {
		if (originalSkipValidation === undefined) {
			delete process.env.SKIP_ENV_VALIDATION;
		} else {
			process.env.SKIP_ENV_VALIDATION = originalSkipValidation;
		}

		if (originalPreviewFlag === undefined) {
			delete process.env.HOUSEKEEPING_NEXT_PREVIEW_ENABLED;
		} else {
			process.env.HOUSEKEEPING_NEXT_PREVIEW_ENABLED = originalPreviewFlag;
		}

		vi.resetModules();
	});

	it.each([
		["true", true],
		["1", true],
		["false", false],
		["yes", false],
		[undefined, false],
	] as const)("normalizes %s to %s", async (value, expected) => {
		if (value === undefined) {
			delete process.env.HOUSEKEEPING_NEXT_PREVIEW_ENABLED;
		} else {
			process.env.HOUSEKEEPING_NEXT_PREVIEW_ENABLED = value;
		}

		const { env } = await import("@/env");

		expect(env.HOUSEKEEPING_NEXT_PREVIEW_ENABLED).toBe(expected);
	});
});
