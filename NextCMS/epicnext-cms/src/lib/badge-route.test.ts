// @ts-nocheck
import { rm } from "node:fs/promises";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "../app/cms_api/imaging/badge/route";

const SCRATCH_ROOT = `${process.cwd()}/storage/imaging/test-badge-route-${process.pid}`;

beforeEach(async () => {
	// Cold disk cache for every test so the candidate walk actually runs.
	await rm(SCRATCH_ROOT, { recursive: true, force: true });
	vi.stubEnv("IMAGING_CACHE_ROOT", SCRATCH_ROOT);
	// A configured CDN short-circuits the database lookup for badge_base_url.
	vi.stubEnv("BADGE_URL", "https://badges.test/album1584");
	globalThis.imagingBadgeFetches?.clear?.();
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

afterAll(async () => {
	await rm(SCRATCH_ROOT, { recursive: true, force: true });
});

function gifResponse() {
	return new Response(new Uint8Array([1, 2, 3]), {
		headers: { "content-type": "image/gif" },
	});
}

it("shares a single upstream fetch across concurrent cold-cache requests", async () => {
	let calls = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			calls += 1;
			await new Promise((resolve) => setTimeout(resolve, 20));
			return gifResponse();
		}),
	);
	const request = () =>
		new NextRequest("https://hotel.test/cms_api/imaging/badge?code=ADM");
	const [a, b] = await Promise.all([GET(request()), GET(request())]);
	expect(a.status).toBe(200);
	expect(b.status).toBe(200);
	expect(a.headers.get("content-type")).toBe("image/gif");
	expect(calls).toBe(1);
});

it("serves a previously fetched badge from disk without re-fetching", async () => {
	const fetcher = vi.fn(async () => gifResponse());
	vi.stubGlobal("fetch", fetcher);
	const request = new NextRequest(
		"https://hotel.test/cms_api/imaging/badge?code=HABBO",
	);
	const first = await GET(request);
	expect(first.status).toBe(200);
	const callsAfterFirst = fetcher.mock.calls.length;
	expect(callsAfterFirst).toBeGreaterThan(0);

	const second = await GET(request);
	expect(second.status).toBe(200);
	expect(second.headers.get("x-imager-source")).toBe("cache");
	expect(fetcher.mock.calls.length).toBe(callsAfterFirst);
});

it("revalidates a cached badge with a 304 when the client already has it", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => gifResponse()),
	);
	const url = "https://hotel.test/cms_api/imaging/badge?code=ETAG";
	const first = await GET(new NextRequest(url));
	const etag = first.headers.get("etag");
	expect(etag).toBeTruthy();

	const second = await GET(
		new NextRequest(url, { headers: { "if-none-match": etag } }),
	);
	expect(second.status).toBe(304);
	expect(second.headers.get("etag")).toBe(etag);
});

it("serves a placeholder when every candidate is unavailable", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("nope", { status: 404 })),
	);
	const result = await GET(
		new NextRequest("https://hotel.test/cms_api/imaging/badge?code=GONE"),
	);
	expect(result.status).toBe(200);
	expect(result.headers.get("content-type")).toBe("image/svg+xml");
	expect(result.headers.get("x-imager-source")).toBe("unavailable");
});

it("rejects malformed badge codes without contacting any candidate", async () => {
	const fetcher = vi.fn();
	vi.stubGlobal("fetch", fetcher);
	const result = await GET(
		new NextRequest("https://hotel.test/cms_api/imaging/badge?code=../bad"),
	);
	expect(result.status).toBe(400);
	expect(fetcher).not.toHaveBeenCalled();
});
