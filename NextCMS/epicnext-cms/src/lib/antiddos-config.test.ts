import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	value: null as string | null,
}));

vi.mock("@/lib/redis", () => ({
	redis: {
		get: async () => state.value,
	},
	__esModule: true,
}));

import {
	antiddosConfigToJson,
	antiddosDefaultsFromEnv,
	getAntiddosConfig,
	invalidateAntiddosConfig,
} from "@/lib/antiddos-config";

describe("antiddos-config", () => {
	beforeEach(() => {
		state.value = null;
		invalidateAntiddosConfig();
	});

	it("returns sane boot defaults without a live override", async () => {
		const config = await getAntiddosConfig();
		expect(config.enabled).toBe(true);
		expect(config.pages.limit).toBeGreaterThan(0);
		expect(config.api.limit).toBeGreaterThan(config.auth.limit);
		expect(config.blockTiers.length).toBeGreaterThan(0);
		expect(config.globalHaltMs).toBeGreaterThan(0);
	});

	it("applies the admin live override from Redis", async () => {
		state.value = JSON.stringify({
			enabled: false,
			auth: { limit: 5, windowSeconds: 30 },
			global: { limit: 1000, windowSeconds: 60 },
			blockTiers: [
				{ minViolations: 3, ttlSeconds: 120 },
				{ minViolations: 9, ttlSeconds: 900 },
			],
		});
		const config = await getAntiddosConfig();
		expect(config.enabled).toBe(false);
		expect(config.auth.limit).toBe(5);
		expect(config.auth.windowSeconds).toBe(30);
		expect(config.pages.limit).toBeGreaterThan(0);
		expect(config.blockTiers.map((t) => t.minViolations)).toEqual([3, 9]);
	});

	it("sanitizes malformed overrides instead of trusting them", async () => {
		state.value = JSON.stringify({
			enabled: true,
			pages: { limit: -5, windowSeconds: "x" },
			blockTiers: "garbage",
		});
		const config = await getAntiddosConfig();
		expect(config.pages.limit).toBeGreaterThan(0);
		expect(Array.isArray(config.blockTiers)).toBe(true);
		expect(config.blockTiers.length).toBeGreaterThan(0);
	});

	it("stores the config JSON serialization", () => {
		const raw = JSON.parse(antiddosConfigToJson(antiddosDefaultsFromEnv()));
		expect(raw.enabled).toBe(true);
		expect(typeof raw.pages.limit).toBe("number");
		expect(Array.isArray(raw.blockTiers)).toBe(true);
	});
});
