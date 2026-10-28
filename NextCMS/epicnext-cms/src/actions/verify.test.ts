// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	clientIp: vi.fn(async () => "203.0.113.7"),
	rateLimit: vi.fn(async () => ({ ok: true, retryAfter: 0 })),
	captchaConfig: vi.fn(async () => ({ provider: "none", field: "" })),
	// Mirrors the real verifier: a missing token never passes.
	verifyCaptcha: vi.fn(async (token: string | null) => Boolean(token)),
	sendVerification: vi.fn(async () => undefined),
	rows: [] as Array<Record<string, unknown>>,
	rateLimitedFor: null as string | null,
	failDb: false,
}));

vi.mock("@/lib/rate-limit", () => ({
	clientIp: state.clientIp,
	rateLimit: vi.fn(async (key: string) => {
		state.rateLimitedFor = key;
		return state.rateLimit();
	}),
}));

vi.mock("@/lib/services/captcha", () => ({
	captchaConfig: state.captchaConfig,
	verifyCaptcha: state.verifyCaptcha,
}));

vi.mock("@/lib/auth/email-verification", () => ({
	sendVerification: state.sendVerification,
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	return {
		...schema,
		db: createFakeDb(() => {
			if (state.failDb) throw new Error("db down");
			return state.rows;
		}),
	};
});

import { resendVerification } from "./verify";

const form = (fields: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
};

const prev = { ok: false, error: null };

beforeEach(() => {
	vi.clearAllMocks();
	state.clientIp.mockResolvedValue("203.0.113.7");
	state.rateLimit.mockResolvedValue({ ok: true, retryAfter: 0 });
	state.captchaConfig.mockResolvedValue({ provider: "none", field: "" });
	state.verifyCaptcha.mockImplementation(async (t) => Boolean(t));
	state.sendVerification.mockResolvedValue(undefined);
	state.rows = [];
	state.rateLimitedFor = null;
	state.failDb = false;
});

describe("resendVerification", () => {
	it("rejects a malformed address", async () => {
		const res = await resendVerification(prev, form({ email: "nope" }));
		expect(res).toEqual({ ok: false, error: "invalid" });
		expect(state.sendVerification).not.toHaveBeenCalled();
	});

	it("sends for an unverified account", async () => {
		state.rows = [{ id: 5, mailVerified: "0" }];
		const res = await resendVerification(
			prev,
			form({ email: "User@Example.com" }),
		);
		expect(res).toEqual({ ok: true, error: null });
		expect(state.sendVerification).toHaveBeenCalledWith("user@example.com");
	});

	it("answers identically for an unknown address so it cannot be probed", async () => {
		state.rows = [];
		const res = await resendVerification(prev, form({ email: "nobody@x.com" }));
		expect(res).toEqual({ ok: true, error: null });
		expect(state.sendVerification).not.toHaveBeenCalled();
	});

	it("does not mail an already verified account", async () => {
		state.rows = [{ id: 5, mailVerified: "1" }];
		const res = await resendVerification(prev, form({ email: "a@b.com" }));
		expect(res).toEqual({ ok: true, error: null });
		expect(state.sendVerification).not.toHaveBeenCalled();
	});

	it("rate limits on the ip", async () => {
		state.rateLimit.mockResolvedValue({ ok: false, retryAfter: 60 });
		const res = await resendVerification(prev, form({ email: "a@b.com" }));
		expect(res).toEqual({ ok: false, error: "rateLimited" });
		expect(state.sendVerification).not.toHaveBeenCalled();
	});

	it("rate limits on the address so rotating ips cannot mail-bomb", async () => {
		state.rateLimit
			.mockResolvedValueOnce({ ok: true, retryAfter: 0 })
			.mockResolvedValueOnce({ ok: false, retryAfter: 300 });
		const res = await resendVerification(prev, form({ email: "a@b.com" }));
		expect(res).toEqual({ ok: false, error: "rateLimited" });
		expect(state.sendVerification).not.toHaveBeenCalled();
	});

	it("reports unavailable when the lookup throws", async () => {
		state.failDb = true;
		const res = await resendVerification(prev, form({ email: "a@b.com" }));
		expect(res).toEqual({ ok: false, error: "unavailable" });
	});
});

describe("resendVerification captcha", () => {
	beforeEach(() => {
		state.captchaConfig.mockResolvedValue({
			provider: "turnstile",
			field: "cf-turnstile-response",
		});
	});

	it("rejects a missing token when a provider is configured", async () => {
		state.rows = [{ id: 5, mailVerified: "0" }];
		const res = await resendVerification(prev, form({ email: "a@b.com" }));
		expect(res).toEqual({ ok: false, error: "captcha" });
		expect(state.verifyCaptcha).toHaveBeenCalledWith(null, "203.0.113.7");
		expect(state.sendVerification).not.toHaveBeenCalled();
	});

	it("rejects a failing token", async () => {
		state.verifyCaptcha.mockResolvedValue(false);
		state.rows = [{ id: 5, mailVerified: "0" }];
		const res = await resendVerification(
			prev,
			form({
				email: "a@b.com",
				"cf-turnstile-response": "bad-token",
			}),
		);
		expect(res).toEqual({ ok: false, error: "captcha" });
		expect(state.sendVerification).not.toHaveBeenCalled();
	});

	it("accepts a valid token and mails the account", async () => {
		state.rows = [{ id: 5, mailVerified: "0" }];
		const res = await resendVerification(
			prev,
			form({ email: "a@b.com", "cf-turnstile-response": "good-token" }),
		);
		expect(res).toEqual({ ok: true, error: null });
		expect(state.verifyCaptcha).toHaveBeenCalledWith(
			"good-token",
			"203.0.113.7",
		);
		expect(state.sendVerification).toHaveBeenCalledWith("a@b.com");
	});

	it("checks the captcha before the account lookup", async () => {
		state.verifyCaptcha.mockResolvedValue(false);
		state.rows = [{ id: 5, mailVerified: "0" }];
		await resendVerification(prev, form({ email: "a@b.com" }));
		const order: string[] = [];
		state.verifyCaptcha.mockImplementation(async () => {
			order.push("captcha");
			return false;
		});
		await resendVerification(prev, form({ email: "a@b.com" }));
		order.push("done");
		expect(order).toEqual(["captcha", "done"]);
	});

	it("does not verify a captcha when no provider is configured", async () => {
		state.captchaConfig.mockResolvedValue({ provider: "none", field: "" });
		state.rows = [{ id: 5, mailVerified: "0" }];
		const res = await resendVerification(prev, form({ email: "a@b.com" }));
		expect(res).toEqual({ ok: true, error: null });
		expect(state.verifyCaptcha).not.toHaveBeenCalled();
	});
});
