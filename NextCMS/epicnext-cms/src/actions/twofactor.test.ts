// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks
const mockRedirect = vi.hoisted(() =>
	vi.fn((url: string) => {
		const err = new Error(`NEXT_REDIRECT: ${url}`);
		(err as any).digest = `NEXT_REDIRECT;replace;${url};307;;`;
		throw err;
	}),
);
vi.mock("next/navigation", () => ({
	redirect: mockRedirect,
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
	revalidatePath: mockRevalidatePath,
	unstable_cache: (fn: unknown) => fn,
}));

vi.mock("next/server", () => ({
	NextResponse: {
		json: vi.fn(),
	},
}));

vi.mock("next-auth", () => ({
	default: vi.fn(() => ({
		handlers: {},
		auth: vi.fn(),
		signOut: vi.fn(),
	})),
}));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({
	auth: mockAuth,
	handlers: {},
	signOut: vi.fn(),
}));

const mockRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({
	rateLimit: mockRateLimit,
}));

const mockVerifyTotp = vi.hoisted(() => vi.fn());
const mockGenerateTotpSecret = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/totp", () => ({
	verifyTotp: mockVerifyTotp,
	generateTotpSecret: mockGenerateTotpSecret,
}));

const mockEncrypt = vi.hoisted(() => vi.fn());
const mockDecrypt = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/laravel-encrypter", () => ({
	LaravelEncrypter: class {
		encrypt = mockEncrypt;
		decrypt = mockDecrypt;
	},
}));

vi.mock("@/env", () => ({
	env: {
		APP_KEY: "base64:dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleTEyMw==",
	},
}));

const hoistedInsertValues = vi.hoisted(() => vi.fn());
const hoistedSelectLimit = vi.hoisted(() => vi.fn());
const hoistedSelectWhere = vi.hoisted(() =>
	vi.fn(() => ({ limit: hoistedSelectLimit })),
);
const hoistedSelectFrom = vi.hoisted(() =>
	vi.fn(() => ({ where: hoistedSelectWhere })),
);
const hoistedUpdateWhere = vi.hoisted(() => vi.fn());
const hoistedUpdateSet = vi.hoisted(() =>
	vi.fn(() => ({ where: hoistedUpdateWhere })),
);

vi.mock("@/lib/db", () => {
	return {
		db: {
			select: vi.fn(() => ({ from: hoistedSelectFrom })),
			insert: vi.fn(() => ({ values: hoistedInsertValues })),
			update: vi.fn(() => ({ set: hoistedUpdateSet })),
		},
		User: {
			id: "user.id",
			twoFactorSecret: "user.twoFactorSecret",
			twoFactorConfirmedAt: "user.twoFactorConfirmedAt",
			twoFactorRecoveryCodes: "user.twoFactorRecoveryCodes",
		},
	};
});

import { db, User } from "@/lib/db";
import { fakeForm } from "@/test/fake-form";
import {
	beginTwoFactor,
	confirmTwoFactor,
	disableTwoFactor,
} from "./twofactor";

beforeEach(() => {
	vi.clearAllMocks();
	mockAuth.mockResolvedValue({ user: { id: "42" } });
	mockRateLimit.mockResolvedValue({ ok: true });
	mockGenerateTotpSecret.mockReturnValue("JBSWY3DPEHPK3PXP");
	mockEncrypt.mockReturnValue("encrypted-secret-payload");
	mockDecrypt.mockReturnValue("JBSWY3DPEHPK3PXP");
	hoistedUpdateWhere.mockResolvedValue([]);
	hoistedSelectLimit.mockResolvedValue([
		{
			twoFactorSecret: "encrypted-secret-payload",
			twoFactorRecoveryCodes: JSON.stringify(["CODE-1234", "CODE-5678"]),
		},
	]);
});

describe("beginTwoFactor", () => {
	it("redirects to login if not signed in", async () => {
		mockAuth.mockResolvedValueOnce(null);
		await expect(beginTwoFactor()).rejects.toThrow("NEXT_REDIRECT: /login");
		expect(mockRedirect).toHaveBeenCalledWith("/login");
	});

	it("generates secret, updates database, and revalidates path", async () => {
		await beginTwoFactor();
		expect(mockGenerateTotpSecret).toHaveBeenCalled();
		expect(mockEncrypt).toHaveBeenCalledWith("JBSWY3DPEHPK3PXP");
		expect(db.update).toHaveBeenCalledWith(User);
		expect(hoistedUpdateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				twoFactorSecret: "encrypted-secret-payload",
				twoFactorConfirmedAt: null,
				twoFactorRecoveryCodes: expect.any(String),
			}),
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/settings/2fa");
	});
});

describe("confirmTwoFactor", () => {
	it("redirects on rate limit", async () => {
		mockRateLimit.mockResolvedValueOnce({ ok: false });
		await expect(
			confirmTwoFactor(fakeForm({ code: "123456" })),
		).rejects.toThrow("NEXT_REDIRECT: /settings/2fa?error=ratelimit");
		expect(mockRedirect).toHaveBeenCalledWith("/settings/2fa?error=ratelimit");
	});

	it("redirects on invalid TOTP and recovery code", async () => {
		mockVerifyTotp.mockReturnValueOnce(false);
		await expect(
			confirmTwoFactor(fakeForm({ code: "INVALID" })),
		).rejects.toThrow("NEXT_REDIRECT: /settings/2fa?error=badcode");
		expect(mockRedirect).toHaveBeenCalledWith("/settings/2fa?error=badcode");
	});

	it("confirms when TOTP code is valid", async () => {
		mockVerifyTotp.mockReturnValueOnce(true);
		await expect(
			confirmTwoFactor(fakeForm({ code: "123456" })),
		).rejects.toThrow("NEXT_REDIRECT: /settings/2fa?enabled=1");
		expect(hoistedUpdateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				twoFactorConfirmedAt: expect.any(Date),
			}),
		);
		expect(mockRedirect).toHaveBeenCalledWith("/settings/2fa?enabled=1");
	});

	it("confirms when recovery code is valid", async () => {
		mockVerifyTotp.mockReturnValueOnce(false);
		await expect(
			confirmTwoFactor(fakeForm({ code: "CODE-1234" })),
		).rejects.toThrow("NEXT_REDIRECT: /settings/2fa?enabled=1");
		expect(mockRedirect).toHaveBeenCalledWith("/settings/2fa?enabled=1");
	});
});

describe("disableTwoFactor", () => {
	it("redirects on invalid code", async () => {
		mockVerifyTotp.mockReturnValueOnce(false);
		await expect(
			disableTwoFactor(fakeForm({ code: "INVALID" })),
		).rejects.toThrow("NEXT_REDIRECT: /settings/2fa?error=badcode");
		expect(mockRedirect).toHaveBeenCalledWith("/settings/2fa?error=badcode");
	});

	it("clears two-factor secret and recovery codes on valid verification", async () => {
		mockVerifyTotp.mockReturnValueOnce(true);
		await expect(
			disableTwoFactor(fakeForm({ code: "123456" })),
		).rejects.toThrow("NEXT_REDIRECT: /settings/2fa?disabled=1");
		expect(hoistedUpdateSet).toHaveBeenCalledWith({
			twoFactorSecret: null,
			twoFactorRecoveryCodes: null,
			twoFactorConfirmedAt: null,
		});
		expect(mockRedirect).toHaveBeenCalledWith("/settings/2fa?disabled=1");
	});
});
