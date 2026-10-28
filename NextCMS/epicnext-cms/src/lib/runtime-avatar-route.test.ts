// @ts-nocheck
import { rm } from "node:fs/promises";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "../app/cms_api/imaging/avatar/route";

// One scratch root for the whole file, removed afterwards: a per-test root left a
// new directory behind for every test, polluting the runtime cache tree.
const SCRATCH_ROOT = `${process.cwd()}/storage/imaging/test-route-${process.pid}`;

beforeEach(() => {
	// Isolated cache root so the disk cache can never leak state between runs or
	// into the runtime cache.
	vi.stubEnv("IMAGING_CACHE_ROOT", SCRATCH_ROOT);
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

afterAll(async () => {
	await rm(SCRATCH_ROOT, { recursive: true, force: true });
});
it("forwards multicolor figures and preserves configured query options at runtime", async () => {
	const figure = "hr-11782-40-40.hd-180-7-14.ch-11592-66.lg-10726-79-1408";
	const fetcher = vi.fn(
		async (_input: string | URL) =>
			new Response(new Uint8Array([1, 2, 3]), {
				headers: { "content-type": "image/png" },
			}),
	);
	vi.stubGlobal("fetch", fetcher);
	for (const hotel of ["alpha", "beta"]) {
		vi.stubEnv("IMAGER_URL", `https://${hotel}.test/avatar?renderer=custom`);
		const result = await GET(
			new NextRequest(
				`https://hotel.test/cms_api/imaging/avatar?figure=${figure}&headonly=1&effect=0`,
			),
		);
		expect(result.status).toBe(200);
		const target = new URL(String(fetcher.mock.calls.at(-1)?.[0]));
		expect(target.origin).toBe(`https://${hotel}.test`);
		expect(target.searchParams.get("figure")).toBe(figure);
		expect(target.searchParams.get("renderer")).toBe("custom");
		expect(target.searchParams.get("headonly")).toBe("1");
	}
});
it("rejects malformed figure input without contacting a renderer", async () => {
	const fetcher = vi.fn();
	vi.stubGlobal("fetch", fetcher);
	expect(
		(
			await GET(
				new NextRequest("https://hotel.test/cms_api/imaging/avatar?figure=../bad"),
			)
		).status,
	).toBe(400);
	expect(fetcher).not.toHaveBeenCalled();
});
it("falls back to the public Habbo renderer when the configured imager is down", async () => {
	const fetcher = vi.fn(async (input: string | URL) => {
		const url = new URL(String(input));
		if (url.origin === "https://hotel.test")
			return new Response("unavailable", { status: 503 });
		return new Response(new Uint8Array([4, 5, 6]), {
			headers: { "content-type": "image/png" },
		});
	});
	vi.stubGlobal("fetch", fetcher);
	vi.stubEnv("IMAGER_URL", "https://hotel.test/avatarimage");
	const result = await GET(
		new NextRequest(
			"https://hotel.test/cms_api/imaging/avatar?figure=hd-180-1&img_format=apng&effect=0",
		),
	);
	expect(result.status).toBe(200);
	expect(result.headers.get("x-imager-source")).toBe("fallback");
	expect(result.headers.get("cache-control")).toContain("max-age=300");
	const target = new URL(String(fetcher.mock.calls.at(-1)?.[0]));
	expect(target.host).toBe("www.habbo.com");
	expect(target.searchParams.get("img_format")).toBe("png");
	expect(target.searchParams.has("effect")).toBe(false);
});

it("serves a previously rendered avatar from the disk cache without re-fetching", async () => {
	const fetcher = vi.fn(
		async (_input: string | URL) =>
			new Response(new Uint8Array([9, 8, 7]), {
				headers: { "content-type": "image/png" },
			}),
	);
	vi.stubGlobal("fetch", fetcher);
	vi.stubEnv("IMAGER_URL", "https://cache.test/avatarimage");
	const request = new NextRequest(
		"https://hotel.test/cms_api/imaging/avatar?figure=hd-123-1",
	);
	const first = await GET(request);
	expect(first.status).toBe(200);
	const callsAfterFirst = fetcher.mock.calls.length;
	expect(callsAfterFirst).toBeGreaterThan(0);

	const second = await GET(request);
	expect(second.status).toBe(200);
	expect(second.headers.get("x-imager-source")).toBe("cache");
	expect(second.headers.get("cache-control")).toContain("max-age=3600");
	// The cached render must not touch the upstream again.
	expect(fetcher.mock.calls.length).toBe(callsAfterFirst);
});

it("revalidates a cached avatar with a 304 when the client already has it", async () => {
	const fetcher = vi.fn(
		async () =>
			new Response(new Uint8Array([1, 2, 3]), {
				headers: { "content-type": "image/png" },
			}),
	);
	vi.stubGlobal("fetch", fetcher);
	vi.stubEnv("IMAGER_URL", "https://etag.test/avatarimage");
	const url = "https://hotel.test/cms_api/imaging/avatar?figure=hd-77-1";
	const first = await GET(new NextRequest(url));
	const etag = first.headers.get("etag");
	expect(etag).toBeTruthy();

	const second = await GET(
		new NextRequest(url, { headers: { "if-none-match": etag } }),
	);
	expect(second.status).toBe(304);
	expect(second.headers.get("etag")).toBe(etag);
	expect(second.headers.get("x-imager-source")).toBe("cache");
});

it("serves a graceful silhouette instead of a broken image when every upstream is down", async () => {
	const fetcher = vi.fn(
		async (_input: string | URL) =>
			new Response("renderer unreachable", { status: 503 }),
	);
	vi.stubGlobal("fetch", fetcher);
	vi.stubEnv("IMAGER_URL", "https://down.test/avatarimage");
	const result = await GET(
		new NextRequest("https://hotel.test/cms_api/imaging/avatar?figure=xd-900-1"),
	);
	expect(result.status).toBe(200);
	expect(result.headers.get("content-type")).toBe("image/svg+xml");
	expect(result.headers.get("x-imager-source")).toBe("unavailable");
	expect(result.headers.get("cache-control")).toContain("no-cache");
});
