// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	// Value the exact COUNT(*) returns, how many times it ran, and per-table
	// totals so a counter cannot quietly report another table's number.
	exact: 0,
	exactRuns: 0,
	fail: false,
	perTable: {} as Record<string, number>,
}));

const tables = vi.hoisted(() => ({
	User: { name: "users" },
	Rooms: { name: "rooms" },
	CameraWeb: { name: "camera_web" },
	WebsiteArticles: { name: "website_articles" },
}));

vi.mock("@/lib/db", () => {
	// Held outside the proxy: reading an unknown property on the proxy returns
	// a function, so a value stored on it would not come back out.
	let current = "";
	const chain: any = new Proxy(() => {}, {
		get: (_t, prop) => {
			if (prop === Symbol.toStringTag) return "Query";
			if (prop === "where") return () => chain;
			if (prop === "from")
				return (table: any) => {
					current = table.name;
					return chain;
				};
			if (prop === "then")
				return (resolve: any, reject: any) => {
					if (state.fail)
						return Promise.reject(Error("db down")).then(resolve, reject);
					state.exactRuns += 1;
					const total =
						current in state.perTable ? state.perTable[current] : state.exact;
					return Promise.resolve([{ total }]).then(resolve, reject);
				};
			return () => chain;
		},
	});
	return {
		db: { select: () => chain, execute: async () => [] },
		...(tables as any),
	};
});

import {
	countArticles,
	countOnline,
	countPhotos,
	countRooms,
	countUsers,
} from "./public-counters";

beforeEach(() => {
	state.exact = 0;
	state.exactRuns = 0;
	state.fail = false;
	state.perTable = {};
});

it("returns exact counts, one query each", async () => {
	state.exact = 165;
	expect(await countUsers()).toBe(165);
	expect(state.exactRuns).toBe(1);
	state.exactRuns = 0;
	state.exact = 92;
	expect(await countRooms()).toBe(92);
	expect(state.exactRuns).toBe(1);
});

it("counts the table each counter claims to count", async () => {
	// The whole point of the module is one function per counter, so the homepage
	// and the boot warm-up cannot disagree under a shared cache key.
	state.perTable = { users: 1, rooms: 2, camera_web: 3 };
	expect(await countUsers()).toBe(1);
	expect(await countRooms()).toBe(2);
	expect(await countPhotos()).toBe(3);
});

it("reports a real zero rather than substituting a stored number", async () => {
	// camera_web is genuinely empty. The estimate this used to read could
	// plausibly have shown a non-zero member count here; exactness cannot.
	state.perTable = { camera_web: 0 };
	expect(await countPhotos()).toBe(0);
});

it("propagates a database failure instead of inventing a number", async () => {
	state.fail = true;
	await expect(countUsers()).rejects.toThrow();
});

it("keeps the online count exact", async () => {
	// A few seconds of drift reads as broken, and it is an indexed count over a
	// small subset, so there is nothing to gain by approximating it.
	state.exact = 12;
	expect(await countOnline()).toBe(12);
});

it("counts the articles table, not the news preview it renders from", async () => {
	// The homepage shows a total article count while the news panel beside it
	// only ever receives the four latest rows — the two must not be conflated.
	state.perTable = { website_articles: 42, users: 7 };
	expect(await countArticles()).toBe(42);
	expect(await countUsers()).toBe(7);
});
