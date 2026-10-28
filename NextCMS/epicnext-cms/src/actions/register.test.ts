// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	rateLimit: vi.fn(async () => ({ ok: true })),
	clientIp: vi.fn(async () => "203.0.113.9"),
	revalidatePath: vi.fn(),
	captchaConfig: vi.fn(async () => ({
		provider: "none",
		siteKey: "",
		field: "cf-turnstile-response",
	})),
	verifyCaptcha: vi.fn(async () => true),
	siteGet: vi.fn(async () => ""),
	siteGetBool: vi.fn(async () => false),
	checkVpn: vi.fn(async () => ({ blocked: false })),
	hashPassword: vi.fn(async (password: string) => `hashed:${password}`),
	invalidateKey: vi.fn(async () => 1),
	recordReferral: vi.fn(async () => undefined),
	sendVerification: vi.fn(async () => undefined),
	logger: { warn: vi.fn(), error: vi.fn() },
	after: vi.fn(),
	afterCb: null as null | (() => Promise<void>),
	insert: vi.fn(async () => [{ insertId: 42 }]),
	userRows: [] as Array<{ id: number }>,
	countTotal: 0,
	failCount: false,
	failUsernameCheck: false,
}));

vi.mock("next/server", () => ({
	after: state.after,
}));
vi.mock("@/lib/auth/email-verification", () => ({
	sendVerification: state.sendVerification,
}));
vi.mock("@/lib/auth/password", () => ({
	hashPassword: state.hashPassword,
}));
vi.mock("@/lib/cached-db", () => ({ invalidateKey: state.invalidateKey }));
vi.mock("@/lib/logger", () => ({ logger: state.logger }));
vi.mock("@/lib/rate-limit", () => ({
	rateLimit: state.rateLimit,
	clientIp: state.clientIp,
}));
vi.mock("@/lib/services/captcha", () => ({
	captchaConfig: state.captchaConfig,
	verifyCaptcha: state.verifyCaptcha,
}));
vi.mock("@/lib/services/ip-lookup", () => ({ checkVpn: state.checkVpn }));
vi.mock("@/lib/services/referrals", () => ({
	recordReferral: state.recordReferral,
}));
vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: {
		get: state.siteGet,
		getBool: state.siteGetBool,
	},
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb(
		(_table: unknown, projection: Record<string, unknown>) => {
			if ("total" in projection) {
				if (state.failCount) return Promise.reject(new Error("count down"));
				return [{ total: state.countTotal }];
			}
			if (state.failUsernameCheck) throw new Error("check down");
			return state.userRows;
		},
	);
	return {
		...schema,
		db: {
			...fake,
			insert: (table: unknown) => ({
				values: (values: unknown) => state.insert(table, values),
			}),
		},
	};
});

import { User } from "@/lib/db";
import { register } from "./register";

const PREV: { error: string | null; ok: boolean } = { error: null, ok: true };

function buildForm(overrides: Record<string, string | undefined> = {}) {
	const f = new FormData();
	f.set("username", "Alice_123");
	f.set("mail", "");
	f.set("password", "Secret1234!@"); // 12+ chars, upper, lower, digit, special
	f.set("password_confirmation", "Secret1234!@");
	f.set("terms", "on");
	for (const [k, v] of Object.entries(overrides)) {
		if (v === undefined) f.delete(k);
		else f.set(k, v);
	}
	return f;
}

async function runValidRegistration() {
	return await register(PREV, buildForm());
}

describe("register", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.rateLimit.mockResolvedValue({ ok: true });
		state.siteGet.mockImplementation(async () => "");
		state.siteGetBool.mockResolvedValue(false);
		state.checkVpn.mockResolvedValue({ blocked: false });
		state.captchaConfig.mockResolvedValue({
			provider: "none",
			siteKey: "",
			field: "cf-turnstile-response",
		});
		state.verifyCaptcha.mockResolvedValue(true);
		state.hashPassword.mockImplementation(
			async (password: string) => `hashed:${password}`,
		);
		state.insert.mockResolvedValue([{ insertId: 42 }]);
		state.afterCb = null;
		state.after.mockImplementation((cb: () => Promise<void>) => {
			state.afterCb = cb;
		});
		state.userRows = [];
		state.countTotal = 0;
		state.failCount = false;
		state.failUsernameCheck = false;
		state.sendVerification.mockResolvedValue(undefined);
		state.recordReferral.mockResolvedValue(undefined);
	});

	it("creates the account and returns ok", async () => {
		const result = await runValidRegistration();
		expect(result).toEqual({ error: null, ok: true });
		expect(state.hashPassword).toHaveBeenCalledWith("Secret1234!@");
		expect(state.insert).toHaveBeenCalledOnce();
		expect(state.insert.mock.calls[0][0]).toBe(User);
		expect(state.insert.mock.calls[0][1]).toMatchObject({
			username: "Alice_123",
			password: "hashed:Secret1234!@",
			mail: null,
			accountCreated: expect.any(Number),
			ipRegister: "203.0.113.9",
			ipCurrent: "203.0.113.9",
			look: "hr-100-1.hd-180-1.ch-255-66.lg-280-110.sh-305-62",
			termsAccepted: true,
		});
		expect(state.invalidateKey).toHaveBeenCalledWith("login:user:Alice_123");
		expect(state.recordReferral).not.toHaveBeenCalled();
		expect(state.after).not.toHaveBeenCalled();
	});

	it("normalizes the username and lowercases the trimmed mail", async () => {
		await register(
			PREV,
			buildForm({ username: "  Bob_88  ", mail: "  Foo@BAR.com " }),
		);
		const values = state.insert.mock.calls[0][1] as {
			username: string;
			mail: string;
		};
		expect(values.username).toBe("Bob_88");
		expect(values.mail).toBe("foo@bar.com");
		expect(state.after).toHaveBeenCalledOnce();
		await state.afterCb?.();
		expect(state.sendVerification).toHaveBeenCalledWith("foo@bar.com");
	});

	it("logs a warning when the verification email fails to send", async () => {
		state.sendVerification.mockRejectedValue(new Error("smtp down"));
		await register(PREV, buildForm({ mail: "x@y.com" }));
		await state.afterCb?.();
		expect(state.logger.warn).toHaveBeenCalledWith(
			"Failed to send verification email after registration",
		);
	});

	it("rejects short usernames", async () => {
		const result = await register(PREV, buildForm({ username: "ab" }));
		expect(result).toEqual({
			error: "Username must be at least 3 characters",
			ok: false,
			code: "usernameMinLength",
		});
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("rejects usernames containing characters outside the allowed set", async () => {
		const result = await register(PREV, buildForm({ username: "bad name!" }));
		expect(result.error).toContain("letters, numbers, underscore and hyphen");
		expect(result.code).toBe("usernamePattern");
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("rejects invalid emails", async () => {
		const result = await register(PREV, buildForm({ mail: "not-an-email" }));
		expect(result).toEqual({
			error: "Enter a valid email address",
			ok: false,
			code: "emailValid",
		});
	});

	it("rejects weak passwords", async () => {
		const result = await register(PREV, buildForm({ password: "short" }));
		expect(result).toEqual({
			error: "Password must be at least 12 characters",
			ok: false,
			code: "passwordMinLength",
		});
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("rejects passwords without an uppercase letter", async () => {
		const result = await register(
			PREV,
			buildForm({
				password: "secret1234!@",
				password_confirmation: "secret1234!@",
			}),
		);
		expect(result.error).toContain("uppercase");
		expect(result.code).toBe("passwordUpper");
	});

	it("rejects passwords without a digit", async () => {
		const result = await register(
			PREV,
			buildForm({
				password: "Secretsecret!",
				password_confirmation: "Secretsecret!",
			}),
		);
		expect(result.error).toContain("digit");
		expect(result.code).toBe("passwordDigit");
	});

	it("rejects passwords without a special character", async () => {
		const result = await register(
			PREV,
			buildForm({
				password: "Secretsecret1",
				password_confirmation: "Secretsecret1",
			}),
		);
		expect(result.error).toContain("special");
		expect(result.code).toBe("passwordSpecial");
	});

	it("rejects mismatched password confirmations", async () => {
		const result = await register(
			PREV,
			buildForm({ password_confirmation: "Different1" }),
		);
		expect(result).toEqual({
			error: "Passwords do not match",
			ok: false,
			code: "passwordsMatch",
		});
	});

	it("throttles sign-ups per IP", async () => {
		state.rateLimit.mockResolvedValueOnce({ ok: false, retryAfter: 120 });
		const result = await runValidRegistration();
		expect(result.error).toContain("Too many sign-up attempts");
		expect(result.code).toBe("rateLimited");
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("verifies the CAPTCHA when one is configured", async () => {
		state.captchaConfig.mockResolvedValue({
			provider: "turnstile",
			siteKey: "key",
			field: "cf-turnstile-response",
		});
		state.verifyCaptcha.mockResolvedValueOnce(false);
		const result = await register(
			PREV,
			buildForm({ "cf-turnstile-response": "token" }),
		);
		expect(result).toEqual({
			error: "Captcha verification failed. Please try again.",
			ok: false,
			code: "captchaFailed",
		});
		expect(state.verifyCaptcha).toHaveBeenCalledWith("token", "203.0.113.9");
		expect(state.insert).not.toHaveBeenCalled();

		state.verifyCaptcha.mockResolvedValueOnce(true);
		const ok = await register(
			PREV,
			buildForm({ "cf-turnstile-response": "token" }),
		);
		expect(ok).toEqual({ error: null, ok: true });
	});

	it("requires accepting the terms", async () => {
		const result = await register(PREV, buildForm({ terms: undefined }));
		expect(result).toEqual({
			error: "You must accept the terms and conditions to register.",
			ok: false,
			code: "termsRequired",
		});
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("blocks VPN registrations with the configured message", async () => {
		state.checkVpn.mockResolvedValue({ blocked: true });
		state.siteGet.mockResolvedValueOnce("Custom VPN message");
		const result = await runValidRegistration();
		expect(result).toEqual({
			error: "Custom VPN message",
			ok: false,
			code: "vpnBlocked",
		});
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("blocks VPN registrations with the default message when unset", async () => {
		state.checkVpn.mockResolvedValue({ blocked: true });
		state.siteGet.mockResolvedValueOnce("");
		const result = await runValidRegistration();
		expect(result.error).toBe(
			"Registrations from VPN/proxy connections are not allowed.",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("blocks the max-account-per-IP cap when the count is reached", async () => {
		state.siteGet.mockResolvedValueOnce("2");
		state.countTotal = 2;
		const result = await runValidRegistration();
		expect(result.error).toContain("maximum number of accounts");
		expect(result.code).toBe("maxAccountsPerIp");
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("allows registration below the max-account cap", async () => {
		state.siteGet.mockResolvedValueOnce("2");
		state.countTotal = 1;
		const result = await runValidRegistration();
		expect(result).toEqual({ error: null, ok: true });
	});

	it("treats a failed account count as unlimited", async () => {
		state.siteGet.mockResolvedValueOnce("2");
		state.failCount = true;
		const result = await runValidRegistration();
		expect(result).toEqual({ error: null, ok: true });
	});

	it("rejects an already-taken username", async () => {
		state.userRows = [{ id: 7 }];
		const result = await runValidRegistration();
		expect(result).toEqual({
			error: "That username is already taken",
			ok: false,
			code: "usernameTaken",
		});
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("returns a temporary failure when the uniqueness check itself fails", async () => {
		state.failUsernameCheck = true;
		const result = await runValidRegistration();
		expect(result).toEqual({
			error: "Registration is temporarily unavailable",
			ok: false,
			code: "unavailable",
		});
		expect(state.logger.warn).toHaveBeenCalledWith(
			"Username uniqueness check failed during registration",
		);
		expect(state.insert).not.toHaveBeenCalled();
	});

	it("maps duplicate-key insert errors to taken username and stays dry on logging", async () => {
		state.insert.mockRejectedValueOnce({
			cause: { code: "ER_DUP_ENTRY" },
		});
		const result = await runValidRegistration();
		expect(result).toEqual({
			error: "That username is already taken",
			ok: false,
			code: "usernameTaken",
		});
		expect(state.logger.error).not.toHaveBeenCalled();
	});

	it("returns a generic creation failure on unexpected insert errors and logs them", async () => {
		state.insert.mockRejectedValueOnce(new Error("db exploded"));
		const result = await runValidRegistration();
		expect(result.error).toContain("Could not create the account");
		expect(result.code).toBe("createFailed");
		expect(state.logger.error).toHaveBeenCalledWith(
			"Account creation failed",
			expect.objectContaining({ message: "db exploded" }),
		);
	});

	it("records a referral when the inviter is provided", async () => {
		await register(PREV, buildForm({ ref: "Veteran" }));
		expect(state.recordReferral).toHaveBeenCalledWith({
			inviterUsername: "Veteran",
			inviteeId: 42,
			inviteeIp: "203.0.113.9",
		});
	});

	it("uses a custom look when one is supplied", async () => {
		await register(PREV, buildForm({ look: "hr-123-42.hd-180-1" }));
		const values = state.insert.mock.calls[0][1] as { look: string };
		expect(values.look).toBe("hr-123-42.hd-180-1");
	});
});
