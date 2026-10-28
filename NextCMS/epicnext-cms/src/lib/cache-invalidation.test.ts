// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	duplicateCalls: 0,
	subscribeCalls: 0,
	published: [] as string[],
	// Simulates another process invalidating a key: delivers a pub/sub message
	// to whichever subscriber this module registered.
	deliver: null as ((channel: string, message: string) => void) | null,
}));

vi.mock("@/lib/redis", () => ({
	redis: {
		status: "ready",
		publish: async (channel: string, key: string) => {
			state.published.push(`${channel}|${key}`);
			return 1;
		},
		duplicate: () => {
			state.duplicateCalls++;
			return {
				on: (event: string, handler: (...args: unknown[]) => void) => {
					if (event === "message") state.deliver = handler;
				},
				subscribe: async () => {
					state.subscribeCalls++;
					return 1;
				},
			};
		},
	},
}));

const { onCacheInvalidated, publishCacheInvalidation } = await import(
	"./cache-invalidation"
);

// The module registers one subscriber for the whole file, so its message handler
// must stay wired between tests; only the subscriptions a test creates are torn
// down, otherwise handlers leak from one test into the next.
const subscriptions: (() => void)[] = [];
function track(handler: (key: string) => void): void {
	subscriptions.push(onCacheInvalidated(handler));
}

beforeEach(() => {
	state.duplicateCalls = 0;
	state.subscribeCalls = 0;
	state.published = [];
});

afterEach(() => {
	while (subscriptions.length) subscriptions.pop()?.();
	vi.unstubAllEnvs();
});

describe("cache invalidation transport", () => {
	it("delivers a key invalidated by another process to local handlers", () => {
		const seen: string[] = [];
		track((key) => seen.push(key));
		state.deliver?.("cache:invalidate", "api:staff");
		expect(seen).toEqual(["api:staff"]);
	});

	it("ignores messages on other channels", () => {
		const seen: string[] = [];
		track((key) => seen.push(key));
		state.deliver?.("some:other:channel", "api:staff");
		expect(seen).toEqual([]);
	});

	it("stops delivering after unsubscribe", () => {
		const seen: string[] = [];
		onCacheInvalidated((key) => seen.push(key))();
		state.deliver?.("cache:invalidate", "api:staff");
		expect(seen).toEqual([]);
	});

	it("keeps delivering to the remaining handlers when one throws", () => {
		const seen: string[] = [];
		track(() => {
			throw new Error("handler blew up");
		});
		track((key) => seen.push(key));
		expect(() => state.deliver?.("cache:invalidate", "k")).not.toThrow();
		expect(seen).toEqual(["k"]);
	});

	it("publishes the invalidated key on the shared channel", async () => {
		await publishCacheInvalidation("api:staff");
		expect(state.published).toEqual(["cache:invalidate|api:staff"]);
	});

	it("opens no connection during a production build", async () => {
		// A live subscriber socket would keep `next build` from ever exiting.
		vi.stubEnv("NEXT_PHASE", "phase-production-build");
		vi.resetModules();
		const build = await import("./cache-invalidation");
		build.onCacheInvalidated(() => {});
		await build.publishCacheInvalidation("api:staff");
		expect(state.duplicateCalls).toBe(0);
		expect(state.subscribeCalls).toBe(0);
	});
});
