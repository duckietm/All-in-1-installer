// @ts-nocheck
import { describe, expect, it, vi } from "vitest";
import { buildContentSecurityPolicy, createCspNonce } from "./csp";

describe("csp", () => {
	it("creates a non-empty base64 nonce", () => {
		const nonce = createCspNonce();
		expect(nonce.length).toBeGreaterThan(8);
		expect(nonce).toMatch(/^[A-Za-z0-9+/=]+$/);
	});

	it("uses a script nonce and omits script unsafe-inline", () => {
		const csp = buildContentSecurityPolicy("testNonce123");
		expect(csp).toContain("script-src");
		expect(csp).toContain("'nonce-testNonce123'");
		expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
		expect(csp).toContain("style-src 'self' 'unsafe-inline'");
		expect(csp).toContain("style-src-attr 'unsafe-inline'");
		expect(csp).toContain("https://challenges.cloudflare.com");
		expect(csp).not.toContain("https://cdn.jsdelivr.net");
	});

	it("blocks framing and upgrades insecure requests outside development", () => {
		vi.stubEnv("NODE_ENV", "production");
		const csp = buildContentSecurityPolicy("n");
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).toContain("upgrade-insecure-requests");
		vi.unstubAllEnvs();
	});

	it("omits upgrade-insecure-requests in development", () => {
		vi.stubEnv("NODE_ENV", "development");
		const csp = buildContentSecurityPolicy("n");
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).not.toContain("upgrade-insecure-requests");
		vi.unstubAllEnvs();
	});
});
