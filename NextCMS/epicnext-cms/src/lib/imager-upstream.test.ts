// @ts-nocheck
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ upstreamCalls: 0 }));

vi.mock("@/lib/imager-cache", () => ({
	avatarCacheDir: () => "/tmp/imager-test",
	imagingCacheKey: (value: string) => value,
	// Nothing is ever cached on disk, so every call reaches the render path and
	// the in-flight map is the only thing that can dedupe it.
	readImagingCache: vi.fn(async () => null),
	writeImagingCache: vi.fn(async () => {}),
}));
vi.mock("@/lib/runtime-asset-config", () => ({
	resolveImagerBase: (origin: string) => `${origin}/imager`,
}));

import {
	fetchAvatarImage,
	ImagerUnavailableError,
	parseAvatarQuery,
} from "./imager-upstream";

const params = new URLSearchParams({ figure: "hr-1", direction: "2" });

beforeEach(() => {
	state.upstreamCalls = 0;
	globalThis.imagingInFlight?.clear();
	// A render is not instantaneous, so every caller launched in the same tick
	// is genuinely in flight at the same time. That overlap is what the
	// in-flight map has to collapse.
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			state.upstreamCalls += 1;
			await new Promise((resolve) => setTimeout(resolve, 5));
			return new Response(new Uint8Array([1, 2, 3]), {
				headers: { "content-type": "image/png" },
			});
		}),
	);
});

it("renders once for many concurrent requests of the same figure", async () => {
	// This is the whole point: a page asks for dozens of avatars at once and
	// repeats figures, and a render is the most expensive thing this app does.
	const results = await Promise.all(
		Array.from({ length: 8 }, () =>
			fetchAvatarImage("https://site.test", params),
		),
	);

	expect(state.upstreamCalls).toBe(1);
	for (const result of results) {
		expect([...result.body]).toEqual([1, 2, 3]);
		expect(result.source).toBe("primary");
	}
});

it("does not dedupe different figures", async () => {
	const other = new URLSearchParams({ figure: "hr-2", direction: "2" });
	await Promise.all([
		fetchAvatarImage("https://site.test", params),
		fetchAvatarImage("https://site.test", other),
	]);
	expect(state.upstreamCalls).toBe(2);
});

it("clears the in-flight entry so a later request reads the cache again", async () => {
	// A leaked entry would pin one promise per figure for the process lifetime
	// and serve the same body forever.
	await fetchAvatarImage("https://site.test", params);
	expect(globalThis.imagingInFlight?.size ?? 0).toBe(0);
});

it("clears the in-flight entry when the render fails", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			throw Error("upstream down");
		}),
	);
	await expect(
		fetchAvatarImage("https://habbo.com/habbo-imaging/avatarimage", params),
	).rejects.toThrow(ImagerUnavailableError);
	expect(globalThis.imagingInFlight?.size ?? 0).toBe(0);
});

it("does not queue a new caller behind a render that is already too old", async () => {
	// Sharing a render is what collapses a cold-cache stampede into one render,
	// but a render that hangs must not hold an unbounded queue behind it. A
	// newcomer past the join window gets the placeholder instead of waiting on
	// somebody else's stalled render.
	let calls = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			calls += 1;
			return new Promise(() => {});
		}),
	);

	// The hung request is the one that asked for the render; it keeps waiting,
	// which is the intended behaviour. Swallow it so it is not an unhandled
	// rejection when the test ends.
	const stalled = fetchAvatarImage("https://site.test", params);
	stalled.catch(() => {});
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(calls).toBe(1);

	const entry = [...(globalThis.imagingInFlight?.values() ?? [])][0];
	expect(entry).toBeDefined();
	entry.startedAt = Date.now() - 60_000;

	await expect(fetchAvatarImage("https://site.test", params)).rejects.toThrow(
		ImagerUnavailableError,
	);
	// Critically, it must not have launched a second render.
	expect(calls).toBe(1);

	// A caller arriving inside the window still shares the render, so the
	// dedupe that matters most is intact.
	globalThis.imagingInFlight?.clear();
	calls = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			calls += 1;
			await new Promise((resolve) => setTimeout(resolve, 5));
			return new Response(new Uint8Array([9]), {
				headers: { "content-type": "image/png" },
			});
		}),
	);
	const shared = await Promise.all([
		fetchAvatarImage("https://site.test", params),
		fetchAvatarImage("https://site.test", params),
	]);
	expect(calls).toBe(1);
	expect([...shared[0].body]).toEqual([9]);
	expect(shared[1].body).toBe(shared[0].body);
});

it("accepts figures the renderer understands even with a trailing segment", () => {
	// The client appends extra segments the imager still draws (e.g. the
	// trailing `.0` here). Rejecting them turned valid avatars into 400s.
	const figure =
		"hr-11782-40-40.hd-180-7-14.ch-11592-66.lg-10726-79-1408.sh-11764-1408.ha-11958-70-1408.wa-2007-0.0";
	const parsed = parseAvatarQuery(new URLSearchParams({ figure }));
	expect(parsed.ok).toBe(true);
	if (parsed.ok) expect(parsed.params.get("figure")).toBe(figure);
});

it("still rejects a figure that is not a figure", () => {
	for (const figure of ["../bad", "hd-180-1/../x", "", "0"]) {
		expect(parseAvatarQuery(new URLSearchParams({ figure })).ok).toBe(false);
	}
});
