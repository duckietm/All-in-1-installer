// @ts-nocheck
import { afterEach, expect, it, vi } from "vitest";
import { validateRuntime } from "../../scripts/docker-start.mjs";
import { resolveBadgeBase, resolveImagerBase } from "./runtime-asset-config";

afterEach(() => vi.unstubAllEnvs());
it("reads different hotel asset settings without reloading the module", () => {
	for (const hotel of ["alpha", "beta"]) {
		vi.stubEnv("IMAGER_URL", `https://${hotel}.test/avatar/`);
		vi.stubEnv("BADGE_URL", `https://${hotel}.test/badges`);
		expect(resolveImagerBase()).toBe(`https://${hotel}.test/avatar`);
		expect(resolveBadgeBase()).toBe(`https://${hotel}.test/badges`);
	}
});
it("supports legacy runtime aliases", () => {
	vi.stubEnv("IMAGER_URL", "");
	vi.stubEnv("BADGE_URL", "");
	vi.stubEnv("NEXT_PUBLIC_IMAGER_URL", "https://legacy.test/avatar");
	vi.stubEnv("NEXT_PUBLIC_BADGE_URL", "https://legacy.test/badges");
	expect(resolveImagerBase()).toBe("https://legacy.test/avatar");
	expect(resolveBadgeBase()).toBe("https://legacy.test/badges");
});
it("resolves a local proxy to its configured upstream and rejects loops", () => {
	vi.stubEnv("IMAGER_URL", "https://hotel.test/imaging");
	vi.stubEnv("IMAGING_UPSTREAM_URL", "http://127.0.0.1:3030/imaging");
	expect(resolveImagerBase("https://hotel.test")).toBe(
		"http://127.0.0.1:3030/imaging",
	);
	vi.stubEnv("IMAGING_UPSTREAM_URL", "https://hotel.test/cms_api/imaging/avatar");
	expect(() => resolveImagerBase("https://hotel.test")).toThrow("proxy loop");
});
it("rejects unsupported asset protocols", () => {
	vi.stubEnv("IMAGER_URL", "file:///private");
	expect(() => resolveImagerBase()).toThrow("protocol");
});
it("requires runtime configuration and never reports secret values", () => {
	expect(() => validateRuntime({})).toThrow(
		"HOTEL_NAME, AUTH_SECRET, DATABASE_URL, APP_URL",
	);
	expect(() =>
		validateRuntime({
			HOTEL_NAME: "Hotel",
			AUTH_SECRET: "x".repeat(32),
			DATABASE_URL: "mysql://u:p@db/hotel",
			APP_URL: "https://hotel.test",
		}),
	).not.toThrow();
	expect(() =>
		validateRuntime({
			HOTEL_NAME: "Build fixture",
			AUTH_SECRET: "build-fixture-".padEnd(40, "x"),
		}),
	).toThrow("HOTEL_NAME, AUTH_SECRET");
});

it("uses the neutral renderer when no installation setting is present", () => {
	for (const name of [
		"IMAGER_URL",
		"NEXT_PUBLIC_IMAGER_URL",
		"IMAGING_UPSTREAM_URL",
	])
		vi.stubEnv(name, "");
	expect(resolveImagerBase()).toBe(
		"https://www.habbo.com/habbo-imaging/avatarimage",
	);
});
