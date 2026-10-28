// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redis", () => ({ redis: null }));

// In-process buckets survive across the module boundary, so every suite uses a
// distinct account id to keep the windows independent.
import {
	clearLoginLockout,
	isLoginLocked,
	LOGIN_MAX_ATTEMPTS,
	recordLoginFailure,
} from "./login-lockout";

beforeEach(() => {
	vi.restoreAllMocks();
});

describe("login lockout", () => {
	it("starts unlocked", async () => {
		expect(await isLoginLocked(1)).toBe(false);
	});

	it("stays unlocked until the attempt budget is exhausted", async () => {
		for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
			expect(await recordLoginFailure(2)).toBe(false);
			expect(await isLoginLocked(2)).toBe(false);
		}
	});

	it("locks on the attempt that exceeds the budget", async () => {
		for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
			await recordLoginFailure(3);
		}
		expect(await recordLoginFailure(3)).toBe(true);
		expect(await isLoginLocked(3)).toBe(true);
	});

	it("clears on a successful authentication", async () => {
		for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
			await recordLoginFailure(4);
		}
		await recordLoginFailure(4);
		expect(await isLoginLocked(4)).toBe(true);

		await clearLoginLockout(4);

		expect(await isLoginLocked(4)).toBe(false);
		expect(await recordLoginFailure(4)).toBe(false);
	});

	it("does not consume an attempt just to check the lock", async () => {
		for (let i = 0; i < 40; i++) {
			await isLoginLocked(5);
		}
		await recordLoginFailure(5);
		// Still one failure recorded, not forty.
		expect(await isLoginLocked(5)).toBe(false);
	});

	it("keeps buckets per account", async () => {
		for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
			await recordLoginFailure(6);
		}
		await recordLoginFailure(6);
		expect(await isLoginLocked(6)).toBe(true);
		expect(await isLoginLocked(7)).toBe(false);
	});
});
