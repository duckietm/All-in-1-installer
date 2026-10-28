// @ts-nocheck
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redis", () => ({
	redis: null,
}));

import { cached, invalidateMemory } from "./cache";

describe("cached (memory-only, no Redis)", () => {
	it("computes once and serves the cached value", async () => {
		const fn = vi.fn(async () => 42);
		const key = `once-${Math.random()}`;
		expect(await cached(key, 10_000, fn)).toBe(42);
		expect(await cached(key, 10_000, fn)).toBe(42);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("dedupes concurrent misses into a single computation", async () => {
		let resolveFn: (value: number) => void = () => {};
		const fn = vi.fn(
			() =>
				new Promise<number>((resolve) => {
					resolveFn = resolve;
				}),
		);
		const key = `dedupe-${Math.random()}`;
		const p1 = cached(key, 10_000, fn);
		const p2 = cached(key, 10_000, fn);
		const p3 = cached(key, 10_000, fn);
		resolveFn(7);
		expect(await Promise.all([p1, p2, p3])).toEqual([7, 7, 7]);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("recomputes after the TTL expires", async () => {
		let count = 0;
		const fn = vi.fn(async () => ++count);
		const key = `ttl-${Math.random()}`;
		const ttl = 20;
		expect(await cached(key, ttl, fn)).toBe(1);
		expect(await cached(key, ttl, fn)).toBe(1);
		await new Promise((r) => setTimeout(r, 40));
		expect(await cached(key, ttl, fn)).toBe(2);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("invalidates a key so the next read recomputes", async () => {
		let count = 0;
		const fn = vi.fn(async () => ++count);
		const key = `inv-${Math.random()}`;
		expect(await cached(key, 10_000, fn)).toBe(1);
		invalidateMemory(key);
		expect(await cached(key, 10_000, fn)).toBe(2);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("evicts the least recently used entry when the cache is full", async () => {
		const fn = vi.fn(async () => 1);
		// Fill well past the budget (default 2 000 entries).
		for (let i = 0; i < 2_100; i++) {
			await cached(`bulk-${i}`, 60_000, fn);
		}
		// "bulk-0" is the least recently used, so it must have been evicted.
		await cached("bulk-0", 60_000, fn);
		expect(fn).toHaveBeenCalledTimes(2_101);
	});

	it("keeps a hot key alive while colder keys churn through the cache", async () => {
		const hot = vi.fn(async () => "hot");
		const cold = vi.fn(async () => "cold");
		const hotKey = `hot-${Math.random()}`;

		expect(await cached(hotKey, 60_000, hot)).toBe("hot");

		// Every iteration reads the hot key first, then floods the cache with
		// fresh one-off keys. Reading must count as using the entry, so the hot
		// key survives even though it was inserted first by a long way.
		for (let i = 0; i < 2_100; i++) {
			await cached(hotKey, 60_000, hot);
			await cached(`churn-${i}`, 60_000, cold);
		}

		expect(hot).toHaveBeenCalledTimes(1);
	});
});

describe("cached (stale-while-revalidate)", () => {
	it("serves the stale value and refreshes behind it", async () => {
		let count = 0;
		const fn = vi.fn(async () => ++count);
		const key = `swr-${Math.random()}`;
		const ttl = 20;
		expect(await cached(key, ttl, fn, { staleMs: 10_000 })).toBe(1);
		await new Promise((r) => setTimeout(r, 40));
		// The expired entry is still served, so the caller never waits on the
		// origin, and the refresh happens behind the response.
		expect(await cached(key, ttl, fn, { staleMs: 10_000 })).toBe(1);
		await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
		expect(await cached(key, ttl, fn, { staleMs: 10_000 })).toBe(2);
	});

	it("recomputes synchronously once the grace window has passed", async () => {
		let count = 0;
		const fn = vi.fn(async () => ++count);
		const key = `swr-expiry-${Math.random()}`;
		const ttl = 20;
		expect(await cached(key, ttl, fn, { staleMs: 20 })).toBe(1);
		await new Promise((r) => setTimeout(r, 80));
		expect(await cached(key, ttl, fn, { staleMs: 20 })).toBe(2);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("keeps serving the stale value when a background refresh fails", async () => {
		const key = `swr-fail-${Math.random()}`;
		const fn = vi
			.fn()
			.mockResolvedValueOnce("first")
			.mockRejectedValue(new Error("origin down"));
		expect(await cached(key, 20, fn, { staleMs: 10_000 })).toBe("first");
		await new Promise((r) => setTimeout(r, 40));
		expect(await cached(key, 20, fn, { staleMs: 10_000 })).toBe("first");
		await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
		expect(await cached(key, 20, fn, { staleMs: 10_000 })).toBe("first");
	});

	it("does not cache the result of a refresh invalidated mid-flight", async () => {
		const key = `swr-invalidate-${Math.random()}`;
		let resolveSlow: (value: string) => void = () => {};
		const slow = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					resolveSlow = resolve;
				}),
		);

		const pending = cached(key, 10_000, slow, { staleMs: 10_000 });
		// The refresh is in flight and an invalidation lands before it resolves.
		invalidateMemory(key);
		resolveSlow("computed-before-invalidation");
		await pending;

		// The outdated value must not have been written back, so the next read
		// recomputes instead of serving what the invalidation just discarded.
		const fresh = vi.fn(async () => "fresh");
		expect(await cached(key, 10_000, fresh)).toBe("fresh");
		expect(await cached(key, 10_000, fresh)).toBe("fresh");
		expect(fresh).toHaveBeenCalledTimes(1);
	});

	it("recovers once the origin comes back after failed background refreshes", async () => {
		const key = `swr-recover-${Math.random()}`;
		const fn = vi
			.fn()
			.mockResolvedValueOnce("first")
			.mockRejectedValueOnce(new Error("origin down"))
			.mockRejectedValueOnce(new Error("origin down"))
			.mockResolvedValue("recovered");

		expect(await cached(key, 20, fn, { staleMs: 10_000 })).toBe("first");
		await new Promise((r) => setTimeout(r, 40));

		// Each stale read kicks off one background refresh; while the origin keeps
		// failing the caller keeps getting the last good value.
		for (const expectedCalls of [2, 3]) {
			expect(await cached(key, 20, fn, { staleMs: 10_000 })).toBe("first");
			await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(expectedCalls));
			// Let the failed refresh settle so the next read starts a new one
			// instead of joining the still-registered in-flight promise.
			await new Promise((r) => setTimeout(r, 10));
		}

		// Once a refresh succeeds, the fresh value replaces the stale one.
		expect(await cached(key, 20, fn, { staleMs: 10_000 })).toBe("first");
		await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(4));
		await vi.waitFor(async () =>
			expect(await cached(key, 20, fn, { staleMs: 10_000 })).toBe("recovered"),
		);
	});

	it("caps the grace window so a large staleMs cannot hide staleness", async () => {
		// A grace window is a cushion for the TTL boundary, not a second TTL. Left
		// unbounded, a 1s TTL paired with a 10 minute window serves data 10 minutes
		// old, which is invisible in the code and only shows up as a support
		// ticket. The ceiling keeps that bounded no matter what a call site asks.
		vi.useFakeTimers();
		try {
			const options = { staleMs: 600_000 };

			// Inside the capped window the value is still served without recomputing,
			// so the cushion itself is not lost.
			let warm = 0;
			const warmFn = async () => ++warm;
			await cached("cap-warm", 1_000, warmFn, options);
			await vi.advanceTimersByTime(119_000);
			expect(await cached("cap-warm", 1_000, warmFn, options)).toBe(1);

			// Past the ceiling the value is recomputed even though the caller asked
			// for a 10 minute window. No prior stale read on this key, so nothing is
			// in flight to short-circuit the recompute.
			let capped = 0;
			const cappedFn = async () => ++capped;
			expect(await cached("cap-hard", 1_000, cappedFn, options)).toBe(1);
			await vi.advanceTimersByTime(121_000);
			expect(await cached("cap-hard", 1_000, cappedFn, options)).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});
});
