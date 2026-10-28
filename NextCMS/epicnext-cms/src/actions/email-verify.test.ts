// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.hoisted(() => vi.fn());
const mockSendMail = vi.hoisted(() => vi.fn());
const mockGetTranslations = vi.hoisted(() => vi.fn());

vi.mock("@/env", () => ({
	env: {
		APP_KEY: "test-app-key-for-hmac",
		AUTH_SECRET: "",
		APP_URL: "http://localhost:3000",
		HOTEL_NAME: "TestHotel",
	},
}));

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { get: mockGet },
}));

vi.mock("@/lib/services/email", () => ({
	sendMail: mockSendMail,
}));

vi.mock("next-intl/server", () => ({
	getTranslations: mockGetTranslations,
}));

import {
	isValidVerificationToken,
	sendVerification,
	verificationToken,
} from "@/lib/auth/email-verification";

beforeEach(() => {
	vi.clearAllMocks();
	mockGet.mockResolvedValue("TestHotel");
	mockSendMail.mockResolvedValue(true);
	mockGetTranslations.mockRejectedValue(new Error("missing"));
});

afterEach(() => {
	vi.useRealTimers();
});

describe("email verification tokens", () => {
	it("issues timestamped HMAC tokens that validate", async () => {
		const token = await verificationToken("User@Example.com");
		expect(token).toMatch(/^\d+\.[a-f0-9]{64}$/);
		expect(await isValidVerificationToken("user@example.com", token)).toBe(
			true,
		);
	});

	it("rejects legacy forever-valid digests", async () => {
		const legacy = "a".repeat(64);
		expect(await isValidVerificationToken("user@example.com", legacy)).toBe(
			false,
		);
	});

	it("rejects expired tokens", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		const token = await verificationToken("user@example.com");
		vi.setSystemTime(new Date("2026-01-03T00:00:00Z")); // > 24h
		expect(await isValidVerificationToken("user@example.com", token)).toBe(
			false,
		);
	});

	it("sends mail with a verify link", async () => {
		mockGetTranslations.mockResolvedValue(((
			key: string,
			values?: { hotel?: string },
		) => {
			const map: Record<string, string> = {
				subject: `Verify your email · ${values?.hotel}`,
				heading: "Verify your email",
				body: `Welcome to ${values?.hotel}!`,
				button: "Verify email",
				fallback: "Paste this link:",
			};
			return map[key] ?? key;
		}) as never);

		await sendVerification("user@example.com");
		expect(mockSendMail).toHaveBeenCalledWith(
			"user@example.com",
			expect.stringContaining("Verify your email"),
			expect.stringContaining("/verify?token="),
		);
	});
});
