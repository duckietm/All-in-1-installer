// @ts-nocheck
import { rm } from "node:fs/promises";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "../app/imaging/route";

// sharp is the one CPU-bound operation on this default-imager route, so the
// tests instrument it directly to prove transcodes are cached rather than
// re-run on every request.
const { sharpMock, counters } = vi.hoisted(() => {
	const counters = {
		calls: 0,
		options: [] as unknown[],
		behavior: "ok" as "ok" | "throw",
	};
	const sharpMock = (_input: unknown, options?: unknown) => {
		counters.calls += 1;
		counters.options.push(options);
		if (counters.behavior === "throw") throw new Error("decode failed");
		return {
			webp: () => ({ toBuffer: async () => Buffer.from([1, 2, 3]) }),
			avif: () => ({ toBuffer: async () => Buffer.from([4, 5, 6]) }),
		};
	};
	return { sharpMock, counters };
});

vi.mock("sharp", () => ({ default: sharpMock }));

// One scratch root for the whole file, removed afterwards, so the disk cache
// never leaks state between tests or into the runtime cache tree.
const SCRATCH_ROOT = `${process.cwd()}/storage/imaging/test-imaging-route-${process.pid}`;

beforeEach(async () => {
	// Cold disk cache for every test: a warm variant would short-circuit the
	// transcode being asserted.
	await rm(SCRATCH_ROOT, { recursive: true, force: true });
	vi.stubEnv("IMAGING_CACHE_ROOT", SCRATCH_ROOT);
	vi.stubEnv("IMAGER_URL", "https://imager.test/avatarimage");
	counters.calls = 0;
	counters.options = [];
	counters.behavior = "ok";
	// Drop any single-flight entries a prior test may have left behind.
	globalThis.imagingTranscodes?.clear?.();
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

afterAll(async () => {
	await rm(SCRATCH_ROOT, { recursive: true, force: true });
});

function stubPngUpstream() {
	const fetcher = vi.fn(
		async () =>
			new Response(new Uint8Array([9, 8, 7]), {
				headers: { "content-type": "image/png" },
			}),
	);
	vi.stubGlobal("fetch", fetcher);
	return fetcher;
}

// A minimal APNG: the PNG signature followed by an `acTL` chunk, which is all
// the animated-format detector needs. sharp cannot re-encode APNG animation in
// this build, so these must be passed through untouched.
function apngBytes(): Uint8Array {
	return new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x61, 0x63,
		0x54, 0x4c, 0, 0, 0, 0,
	]);
}

it("re-encodes an avatar to WebP and caches the variant across requests", async () => {
	const fetcher = stubPngUpstream();
	const request = new NextRequest(
		"https://hotel.test/imaging?figure=hd-180-1&format=webp",
	);

	const first = await GET(request);
	expect(first.status).toBe(200);
	expect(first.headers.get("content-type")).toBe("image/webp");
	expect(counters.calls).toBe(1);

	const fetchesAfterFirst = fetcher.mock.calls.length;
	const second = await GET(request);
	expect(second.status).toBe(200);
	expect(second.headers.get("content-type")).toBe("image/webp");
	// Served entirely from disk cache: neither the upstream nor sharp re-ran.
	expect(counters.calls).toBe(1);
	expect(fetcher.mock.calls.length).toBe(fetchesAfterFirst);
});

it("decodes with animation awareness for transcodeable inputs", async () => {
	stubPngUpstream();
	const result = await GET(
		new NextRequest("https://hotel.test/imaging?figure=hd-180-1&format=webp"),
	);
	expect(result.status).toBe(200);
	expect(counters.options.at(-1)).toMatchObject({ animated: true });
});

it("leaves an animated PNG untouched instead of dropping its frames", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(apngBytes(), {
					headers: { "content-type": "image/png" },
				}),
		),
	);
	const result = await GET(
		new NextRequest("https://hotel.test/imaging?figure=hd-180-1&format=webp"),
	);
	expect(result.status).toBe(200);
	// Original bytes/content-type preserved and sharp never ran.
	expect(result.headers.get("content-type")).toBe("image/png");
	expect(counters.calls).toBe(0);
});

it("shares a single transcode across concurrent cold-cache requests", async () => {
	stubPngUpstream();
	const request = () =>
		new NextRequest("https://hotel.test/imaging?figure=hd-180-1&format=avif");
	const [a, b] = await Promise.all([GET(request()), GET(request())]);
	expect(a.status).toBe(200);
	expect(b.status).toBe(200);
	expect(counters.calls).toBe(1);
});

it("falls back to the original render when the transcode fails", async () => {
	stubPngUpstream();
	counters.behavior = "throw";
	const result = await GET(
		new NextRequest("https://hotel.test/imaging?figure=hd-180-1&format=webp"),
	);
	expect(result.status).toBe(200);
	expect(result.headers.get("content-type")).toBe("image/png");
});

it("revalidates a cached avatar with a 304 when the client already has it", async () => {
	stubPngUpstream();
	const url = "https://hotel.test/imaging?figure=hd-55-1";
	const first = await GET(new NextRequest(url));
	const etag = first.headers.get("etag");
	expect(etag).toBeTruthy();

	const second = await GET(
		new NextRequest(url, { headers: { "if-none-match": etag } }),
	);
	expect(second.status).toBe(304);
	expect(second.headers.get("etag")).toBe(etag);
});

it("serves the graceful silhouette instead of a broken image when every upstream is down", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("down", { status: 503 })),
	);
	const result = await GET(
		new NextRequest("https://hotel.test/imaging?figure=xd-900-1&format=webp"),
	);
	expect(result.status).toBe(200);
	expect(result.headers.get("content-type")).toBe("image/svg+xml");
	expect(result.headers.get("x-imager-source")).toBe("unavailable");
	expect(result.headers.get("cache-control")).toContain("no-cache");
});
