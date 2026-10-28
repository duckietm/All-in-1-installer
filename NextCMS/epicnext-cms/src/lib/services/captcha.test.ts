// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.hoisted(() => vi.fn());

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { get: mockGet },
}));

import { captchaConfig, verifyCaptcha } from "./captcha";

beforeEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("verifyCaptcha", () => {
	it("allows when provider is none", async () => {
		mockGet.mockImplementation(async (key: string, fallback?: string) => {
			if (key === "captcha_provider") return "none";
			return fallback ?? "";
		});
		expect(await verifyCaptcha(null)).toBe(true);
	});

	it("fails closed when provider set but secret missing", async () => {
		mockGet.mockImplementation(async (key: string, fallback?: string) => {
			if (key === "captcha_provider") return "turnstile";
			if (key === "turnstile_site_key") return "site-key";
			if (key === "turnstile_secret") return "";
			return fallback ?? "";
		});
		expect(await verifyCaptcha("tok")).toBe(false);
	});

	it("fails closed on provider API/network errors", async () => {
		mockGet.mockImplementation(async (key: string, fallback?: string) => {
			if (key === "captcha_provider") return "turnstile";
			if (key === "turnstile_site_key") return "site-key";
			if (key === "turnstile_secret") return "secret";
			return fallback ?? "";
		});
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("network down")),
		);
		expect(await verifyCaptcha("tok", "1.2.3.4")).toBe(false);
	});

	it("accepts a successful provider response", async () => {
		mockGet.mockImplementation(async (key: string, fallback?: string) => {
			if (key === "captcha_provider") return "recaptcha";
			if (key === "recaptcha_site_key") return "site-key";
			if (key === "recaptcha_secret") return "secret";
			return fallback ?? "";
		});
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ success: true }),
			}),
		);
		expect(await verifyCaptcha("good-token")).toBe(true);
	});
});

describe("captchaConfig", () => {
	it("returns none by default", async () => {
		mockGet.mockImplementation(async (_key: string, fallback?: string) => {
			return fallback ?? "none";
		});
		const cfg = await captchaConfig();
		expect(cfg.provider).toBe("none");
	});
});

describe("env fallback", () => {
	it("enables Turnstile from env when the DB is unconfigured", async () => {
		mockGet.mockResolvedValue("");
		vi.stubEnv("CAPTCHA_PROVIDER", "turnstile");
		vi.stubEnv("TURNSTILE_SITE_KEY", "env-site-key");
		const cfg = await captchaConfig();
		expect(cfg.provider).toBe("turnstile");
		expect(cfg.siteKey).toBe("env-site-key");
		expect(cfg.field).toBe("cf-turnstile-response");
	});

	it("lets an explicit DB value — including none — win over env", async () => {
		mockGet.mockImplementation(async (key: string) => {
			if (key === "captcha_provider") return "none";
			return "";
		});
		vi.stubEnv("CAPTCHA_PROVIDER", "turnstile");
		vi.stubEnv("TURNSTILE_SITE_KEY", "env-site-key");
		const cfg = await captchaConfig();
		expect(cfg.provider).toBe("none");
	});

	it("prefers the DB site key over the env one", async () => {
		mockGet.mockImplementation(async (key: string) => {
			if (key === "captcha_provider") return "turnstile";
			if (key === "turnstile_site_key") return "db-site-key";
			return "";
		});
		vi.stubEnv("TURNSTILE_SITE_KEY", "env-site-key");
		const cfg = await captchaConfig();
		expect(cfg.siteKey).toBe("db-site-key");
	});

	it("verifies against the env secret when the DB secret is unset", async () => {
		mockGet.mockResolvedValue("");
		vi.stubEnv("CAPTCHA_PROVIDER", "turnstile");
		vi.stubEnv("TURNSTILE_SITE_KEY", "env-site-key");
		vi.stubEnv("TURNSTILE_SECRET_KEY", "env-secret");
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: true }),
		});
		vi.stubGlobal("fetch", fetchMock);
		expect(await verifyCaptcha("tok", "1.2.3.4")).toBe(true);
		expect(fetchMock).toHaveBeenCalledOnce();
		const [, init] = fetchMock.mock.calls[0];
		expect((init.body as URLSearchParams).get("secret")).toBe("env-secret");
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://challenges.cloudflare.com/turnstile/v0/siteverify",
		);
	});

	it("fails closed when the provider comes from env but no secret exists", async () => {
		mockGet.mockResolvedValue("");
		vi.stubEnv("CAPTCHA_PROVIDER", "turnstile");
		vi.stubEnv("TURNSTILE_SITE_KEY", "env-site-key");
		expect(await verifyCaptcha("tok")).toBe(false);
	});
});
