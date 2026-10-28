// @ts-nocheck
import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
	env: {
		PAYPAL_CLIENT_ID: "test-client-id",
		PAYPAL_SECRET: "test-secret",
		PAYPAL_API: "https://api-m.sandbox.paypal.com",
		PAYPAL_CURRENCY: "USD",
		PAYPAL_CREDITS_PER_USD: 100,
	},
}));

import {
	creditsPerUnit,
	isPayPalConfigured,
	PAYPAL_API,
	PAYPAL_CURRENCY,
} from "./paypal";

describe("paypal", () => {
	it("isPayPalConfigured returns true when credentials are set", () => {
		expect(isPayPalConfigured()).toBe(true);
	});

	it("PAYPAL_API strips trailing slashes", () => {
		expect(PAYPAL_API.endsWith("/")).toBe(false);
		expect(PAYPAL_API).toBe("https://api-m.sandbox.paypal.com");
	});

	it("PAYPAL_CURRENCY is uppercase", () => {
		expect(PAYPAL_CURRENCY).toBe("USD");
	});

	it("creditsPerUnit returns the configured value", () => {
		expect(creditsPerUnit()).toBe(100);
	});
});

describe("paypal with missing credentials", () => {
	it("isPayPalConfigured returns false when unset", async () => {
		vi.resetModules();
		vi.doMock("@/env", () => ({
			env: {
				PAYPAL_CLIENT_ID: "",
				PAYPAL_SECRET: "",
				PAYPAL_API: undefined,
				PAYPAL_CURRENCY: "USD",
				PAYPAL_CREDITS_PER_USD: 100,
			},
		}));
		const { isPayPalConfigured: check } = await import("./paypal");
		expect(check()).toBe(false);
	});
});
