// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redis", () => ({
	redis: null,
}));

import { clearRateLimit, peekRateLimit, rateLimit } from "./rate-limit";

beforeEach(() => {
	vi.restoreAllMocks();
});

describe("rateLimit (in-memory fallback)", () => {
	it("allows the first request", async () => {
		const res = await rateLimit("test:1", 3, 60_000);
		expect(res.ok).toBe(true);
		expect(res.retryAfter).toBe(0);
	});

	it("allows up to the limit within a window", async () => {
		const key = `test:2:${Date.now()}`;
		expect((await rateLimit(key, 2, 60_000)).ok).toBe(true);
		expect((await rateLimit(key, 2, 60_000)).ok).toBe(true);
		const res = await rateLimit(key, 2, 60_000);
		expect(res.ok).toBe(false);
		expect(res.retryAfter).toBeGreaterThan(0);
	});

	it("resets after the window expires", async () => {
		const key = `test:3:${Date.now()}`;
		await rateLimit(key, 1, 50);
		const res1 = await rateLimit(key, 1, 50);
		expect(res1.ok).toBe(false);
		await new Promise((r) => setTimeout(r, 60));
		const res2 = await rateLimit(key, 1, 50);
		expect(res2.ok).toBe(true);
	});

	it("uses separate keys independently", async () => {
		const a = await rateLimit("key-a", 1, 60_000);
		const b = await rateLimit("key-b", 1, 60_000);
		expect(a.ok).toBe(true);
		expect(b.ok).toBe(true);
		const a2 = await rateLimit("key-a", 1, 60_000);
		expect(a2.ok).toBe(false);
	});
});

describe("peekRateLimit", () => {
	it("reports a fresh bucket as available without consuming a unit", async () => {
		const key = `peek:fresh:${Date.now()}`;
		const first = await peekRateLimit(key, 2, 60_000);
		expect(first.ok).toBe(true);
		expect(first.retryAfter).toBe(0);
	});

	it("does not consume a unit", async () => {
		const key = `peek:noconsume:${Date.now()}`;
		await peekRateLimit(key, 2, 60_000);
		await peekRateLimit(key, 2, 60_000);
		await peekRateLimit(key, 2, 60_000);
		// Three peeks, budget of two: still allowed, and count is still 0.
		expect((await peekRateLimit(key, 2, 60_000)).ok).toBe(true);
		expect((await rateLimit(key, 2, 60_000)).ok).toBe(true);
		expect((await rateLimit(key, 2, 60_000)).ok).toBe(true);
		expect((await rateLimit(key, 2, 60_000)).ok).toBe(false);
	});

	it("reports a bucket that is already over the limit", async () => {
		const key = `peek:over:${Date.now()}`;
		await rateLimit(key, 1, 60_000);
		expect((await peekRateLimit(key, 1, 60_000)).ok).toBe(true);
		await rateLimit(key, 1, 60_000);
		const res = await peekRateLimit(key, 1, 60_000);
		expect(res.ok).toBe(false);
		expect(res.retryAfter).toBeGreaterThan(0);
	});

	it("reports an expired bucket as available again", async () => {
		const key = `peek:expired:${Date.now()}`;
		await rateLimit(key, 1, 50);
		await rateLimit(key, 1, 50);
		expect((await peekRateLimit(key, 1, 50)).ok).toBe(false);
		await new Promise((r) => setTimeout(r, 60));
		expect((await peekRateLimit(key, 1, 50)).ok).toBe(true);
	});
});

describe("clearRateLimit", () => {
	it("empties the bucket so the limit is fully available again", async () => {
		const key = `clear:basic:${Date.now()}`;
		expect((await rateLimit(key, 2, 60_000)).ok).toBe(true);
		expect((await rateLimit(key, 2, 60_000)).ok).toBe(true);
		expect((await rateLimit(key, 2, 60_000)).ok).toBe(false);

		await clearRateLimit(key);

		expect((await peekRateLimit(key, 2, 60_000)).ok).toBe(true);
		expect((await rateLimit(key, 2, 60_000)).ok).toBe(true);
	});

	it("is a no-op on an unknown key", async () => {
		await expect(
			clearRateLimit(`clear:missing:${Date.now()}`),
		).resolves.toBeUndefined();
	});
});
