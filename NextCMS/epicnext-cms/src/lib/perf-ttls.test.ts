import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * perf-ttls reads the CMS_* env vars at module load, so each case re-imports
 * with a freshly stubbed process.env (vitest sets SKIP_ENV_VALIDATION=1, so
 * @/env is the raw process.env object and vi.stubEnv is visible to it).
 */
async function loadTtls() {
	return await import("@/lib/perf-ttls");
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe("perf-ttls", () => {
	it("uses the documented defaults when the env is unset", async () => {
		const mod = await loadTtls();
		expect(mod.HOME_PAYLOAD_TTL_MS).toBe(15_000);
		expect(mod.NEWS_LIST_TTL_MS).toBe(300_000);
		expect(mod.NEWS_ARCHIVE_TTL_MS).toBe(60_000);
		expect(mod.PUBLIC_SEARCH_TTL_MS).toBe(30_000);
		expect(mod.ONLINE_COUNT_TTL_MS).toBe(10_000);
		expect(mod.COUNTERS_TTL_MS).toBe(300_000);
		expect(mod.SITE_SETTINGS_TTL_MS).toBe(300_000);
		expect(mod.SITE_SETTINGS_MEMORY_TTL_MS).toBe(60_000);
		expect(mod.CACHE_WARMUP_ENABLED).toBe(true);
	});

	it("honours env overrides (seconds → ms)", async () => {
		vi.stubEnv("CMS_HOME_PAYLOAD_TTL_SEC", "99");
		vi.stubEnv("CMS_ONLINE_COUNT_TTL_SEC", "3");
		vi.stubEnv("CMS_WARMUP_ENABLED", "false");
		const mod = await loadTtls();
		expect(mod.HOME_PAYLOAD_TTL_MS).toBe(99_000);
		expect(mod.ONLINE_COUNT_TTL_MS).toBe(3_000);
		expect(mod.CACHE_WARMUP_ENABLED).toBe(false);
		// Untouched keys keep their defaults.
		expect(mod.NEWS_LIST_TTL_MS).toBe(300_000);
	});

	it("ignores invalid numbers and keeps the default", async () => {
		vi.stubEnv("CMS_NEWS_ARCHIVE_TTL_SEC", "not-a-number");
		const mod = await loadTtls();
		expect(mod.NEWS_ARCHIVE_TTL_MS).toBe(60_000);
	});

	it("treats zero and negative values as unset", async () => {
		vi.stubEnv("CMS_SEARCH_TTL_SEC", "0");
		const mod = await loadTtls();
		expect(mod.PUBLIC_SEARCH_TTL_MS).toBe(30_000);
	});
});
