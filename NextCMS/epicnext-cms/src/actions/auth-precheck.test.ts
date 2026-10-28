// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { captchaConfig, verifyCaptcha } from "@/lib/services/captcha";
import { precheckLogin } from "./auth-precheck";

const core = vi.hoisted(() => ({
	getLoginUser: vi.fn(),
	verifyLoginPassword: vi.fn(),
	isEmailUnverified: vi.fn(),
	runDummyHashCheck: vi.fn(),
	normalizeLoginInput: (username: unknown, password: unknown) => ({
		username: String(username ?? "")
			.normalize("NFC")
			.trim(),
		password: String(password ?? "").normalize("NFC"),
	}),
	isLoginLocked: vi.fn(async () => false),
	recordLoginFailure: vi.fn(async () => false),
	clearLoginLockout: vi.fn(async () => undefined),
}));

vi.mock("@/env", () => ({ env: {} }));
vi.mock("@/lib/auth/login-core", () => core);
vi.mock("@/lib/rate-limit", () => ({ clientIp: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/lib/services/captcha", () => ({
	captchaConfig: vi.fn(),
	verifyCaptcha: vi.fn(),
}));
vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { getBool: vi.fn() },
}));
vi.mock("@/lib/auth/login-lockout", () => ({
	isLoginLocked: core.isLoginLocked,
	recordLoginFailure: core.recordLoginFailure,
	clearLoginLockout: core.clearLoginLockout,
}));

const user = (overrides = {}) => ({
	id: 42,
	password: "hash",
	twoFactorConfirmedAt: null,
	mail: null,
	mailVerified: "0",
	...overrides,
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(clientIp).mockResolvedValue("1.2.3.4");
	vi.mocked(rateLimit).mockResolvedValue({ ok: true });
	vi.mocked(captchaConfig).mockResolvedValue({ provider: "none" } as never);
	core.getLoginUser.mockResolvedValue(null);
	core.verifyLoginPassword.mockResolvedValue({ valid: true });
	core.isEmailUnverified.mockResolvedValue(false);
	core.runDummyHashCheck.mockResolvedValue(undefined);
	core.isLoginLocked.mockResolvedValue(false);
	core.recordLoginFailure.mockResolvedValue(false);
	core.clearLoginLockout.mockResolvedValue(undefined);
});

describe("precheckLogin", () => {
	it("returns ok for valid login without 2FA", async () => {
		core.getLoginUser.mockResolvedValue(user());
		expect(await precheckLogin("user", "pass")).toBe("ok");
	});

	it("returns twofactor when 2FA is set up", async () => {
		core.getLoginUser.mockResolvedValue(
			user({ twoFactorConfirmedAt: new Date() }),
		);
		expect(await precheckLogin("user", "pass")).toBe("twofactor");
	});

	it("returns invalid for empty inputs", async () => {
		expect(await precheckLogin("", "")).toBe("invalid");
	});

	it("returns captcha when captcha required", async () => {
		vi.mocked(captchaConfig).mockResolvedValue({
			provider: "hcaptcha",
		} as never);
		vi.mocked(verifyCaptcha).mockResolvedValue(false);
		core.getLoginUser.mockResolvedValue(user());
		expect(await precheckLogin("user", "pass", "bad-token")).toBe("captcha");
	});

	it("returns invalid when user not found (dummy hash check)", async () => {
		core.getLoginUser.mockResolvedValue(null);
		const result = await precheckLogin("nonexistent", "pass");
		expect(result).toBe("invalid");
		expect(core.runDummyHashCheck).toHaveBeenCalled();
	});

	it("returns unverified when email verification required", async () => {
		core.getLoginUser.mockResolvedValue(user({ mail: "user@example.com" }));
		core.isEmailUnverified.mockResolvedValue(true);
		expect(await precheckLogin("user", "pass")).toBe("unverified");
	});

	it("returns locked for an account that is already locked out", async () => {
		core.getLoginUser.mockResolvedValue(user());
		core.isLoginLocked.mockResolvedValue(true);
		expect(await precheckLogin("user", "pass")).toBe("locked");
		// The password is never verified while locked, so a correct password
		// cannot walk a locked account back in.
		expect(core.verifyLoginPassword).not.toHaveBeenCalled();
		expect(core.clearLoginLockout).not.toHaveBeenCalled();
	});

	it("checks the lockout before verifying the password", async () => {
		core.getLoginUser.mockResolvedValue(user());
		const order: string[] = [];
		core.getLoginUser.mockImplementation(async () => {
			order.push("lookup");
			return user();
		});
		core.isLoginLocked.mockImplementation(async () => {
			order.push("lock");
			return false;
		});
		core.verifyLoginPassword.mockImplementation(async () => {
			order.push("verify");
			return { valid: true };
		});
		expect(await precheckLogin("user", "pass")).toBe("ok");
		expect(order).toEqual(["lookup", "lock", "verify"]);
	});

	it("records a failure and skips the clear when the password is wrong", async () => {
		core.getLoginUser.mockResolvedValue(user());
		core.verifyLoginPassword.mockResolvedValue({ valid: false });
		core.recordLoginFailure.mockResolvedValue(false);
		expect(await precheckLogin("user", "pass")).toBe("invalid");
		expect(core.recordLoginFailure).toHaveBeenCalledWith(42);
		expect(core.clearLoginLockout).not.toHaveBeenCalled();
	});

	it("clears the lockout after a successful authentication", async () => {
		core.getLoginUser.mockResolvedValue(user());
		expect(await precheckLogin("user", "pass")).toBe("ok");
		expect(core.clearLoginLockout).toHaveBeenCalledWith(42);
		expect(core.recordLoginFailure).not.toHaveBeenCalled();
	});

	it("does not lock or clear a bucket for an unknown account", async () => {
		core.getLoginUser.mockResolvedValue(null);
		expect(await precheckLogin("nonexistent", "pass")).toBe("invalid");
		expect(core.isLoginLocked).not.toHaveBeenCalled();
		expect(core.recordLoginFailure).not.toHaveBeenCalled();
		expect(core.clearLoginLockout).not.toHaveBeenCalled();
	});
});
