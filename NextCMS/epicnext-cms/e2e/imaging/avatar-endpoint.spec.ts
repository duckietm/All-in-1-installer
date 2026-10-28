import { expect, test } from "@playwright/test";
import {
	avatarPath,
	countBytes,
	fetchThroughEdge,
	getThroughEdge,
	looksLikeImage,
} from "./imaging-target";

// Endpoints exercised here are identical whether the CMS is reached directly
// or through the edge proxy, so this spec runs unchanged in the deploy gate and
// in the cross-browser job. Topology-specific checks live in
// `cms-imaging.spec.ts` (direct only) and `public-routing.spec.ts` (edge only).

const IMAGE_SOURCES = new Set([
	"primary",
	"fallback",
	"cache",
	"cache-stale",
	"unavailable",
]);

test("renders an animated APNG for a figure with an effect", async ({
	request,
}) => {
	const response = await getThroughEdge(
		request,
		avatarPath({ img_format: "apng", effect: "14" }),
	);
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toContain("image/");
	// `unavailable` means the placeholder was served, i.e. no real render.
	expect(response.headers()["x-imager-source"]).not.toBe("unavailable");

	const body = await response.body();
	expect(body.length).toBeGreaterThan(1000);
	// APNG signature chunks: `acTL` announces the animation, `fcTL` marks frames.
	expect(body.includes(Buffer.from("acTL"))).toBe(true);
	expect(countBytes(body, Buffer.from("fcTL"))).toBeGreaterThan(1);
});

test("serves a static PNG when no animation is requested", async ({
	request,
}) => {
	const response = await getThroughEdge(
		request,
		avatarPath({ img_format: "png" }),
	);
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toContain("image/png");
	const body = await response.body();
	expect(body.subarray(1, 4).toString("ascii")).toBe("PNG");
});

test("advertises a cacheable response and a known render source", async ({
	request,
}) => {
	const response = await getThroughEdge(
		request,
		avatarPath({ img_format: "png" }),
	);
	expect(response.status()).toBe(200);

	const source = response.headers()["x-imager-source"];
	expect(source, "x-imager-source header").toBeTruthy();
	expect(IMAGE_SOURCES.has(source as string)).toBe(true);

	const cacheControl = response.headers()["cache-control"];
	expect(cacheControl, "cache-control header").toContain("public");
	expect(cacheControl).toMatch(/max-age=\d+/);

	// Render sources other than the graceful placeholder are worth caching.
	if (source !== "unavailable") {
		expect(cacheControl).not.toContain("no-cache");
	}
});

test("answers conditional requests with 304", async ({ request }) => {
	const first = await getThroughEdge(
		request,
		avatarPath({ img_format: "png" }),
	);
	expect(first.status()).toBe(200);
	const etag = first.headers().etag;
	expect(etag).toBeTruthy();

	const second = await getThroughEdge(
		request,
		avatarPath({ img_format: "png" }),
		{
			headers: { "if-none-match": etag as string },
		},
	);
	expect(second.status()).toBe(304);
	expect(second.headers().etag).toBe(etag);
});

test("serves the rendered avatar behind permissive CORS", async ({
	request,
}) => {
	const response = await getThroughEdge(
		request,
		avatarPath({ img_format: "png" }),
	);
	expect(response.status()).toBe(200);
	expect(response.headers()["access-control-allow-origin"]).toBe("*");
});

test("preflight requests advertise GET and revalidation", async ({
	request,
}) => {
	const response = await fetchThroughEdge(request, avatarPath(), {
		method: "OPTIONS",
	});
	expect(response.status()).toBe(204);
	expect(response.headers()["access-control-allow-origin"]).toBe("*");
	expect(response.headers()["access-control-allow-methods"]).toContain("GET");
	expect(response.headers()["access-control-allow-headers"]).toContain(
		"If-None-Match",
	);
});

test.describe("rejects malformed figures", () => {
	const cases: Array<{ name: string; query: string }> = [
		{ name: "missing figure", query: "" },
		{ name: "empty figure", query: "?figure=" },
		{ name: "path traversal", query: "?figure=../bad" },
		{ name: "separator injection", query: "?figure=hd-180-1/../x" },
		{
			name: "over-long figure",
			query: `?figure=hd-180-${"x".repeat(600)}`,
		},
		{
			name: "too many parts",
			query: `?figure=hd-180${".a-1".repeat(30)}`,
		},
	];

	for (const { name, query } of cases) {
		test(name, async ({ request }) => {
			const response = await getThroughEdge(
				request,
				`/api/imaging/avatar${query}`,
			);
			expect(response.status()).toBe(400);
		});
	}
});

test("collapses a burst of concurrent requests for one figure", async ({
	request,
}) => {
	// Vary the key so this can hit a cold (or at least distinct) render while a
	// page-load style burst is in flight. Every response must still be a real
	// image — single-flight must not turn contention into 5xx/placeholders.
	const path = avatarPath({
		img_format: "png",
		direction: "6",
		head_direction: "1",
	});
	const responses = await Promise.all(
		Array.from({ length: 6 }, () => getThroughEdge(request, path)),
	);
	for (const response of responses) {
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("image/");
		expect(looksLikeImage(await response.body())).toBe(true);
	}
});

test("the badge endpoint serves an image and revalidates", async ({
	request,
}) => {
	const first = await getThroughEdge(request, "/api/imaging/badge?code=ADM");
	expect(first.status()).toBe(200);
	expect(first.headers()["content-type"]).toContain("image/");
	expect(first.headers()["access-control-allow-origin"]).toBe("*");
	const etag = first.headers().etag;
	expect(etag).toBeTruthy();

	const second = await getThroughEdge(request, "/api/imaging/badge?code=ADM", {
		headers: { "if-none-match": etag as string },
	});
	expect(second.status()).toBe(304);
});

test("the badge endpoint can resolve from a local source", async ({
	request,
}) => {
	const response = await getThroughEdge(
		request,
		"/api/imaging/badge?code=ADM&source=local",
	);
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toContain("image/");
	expect(response.headers()["x-imager-source"]).toBeTruthy();
});

test.describe("rejects malformed badge codes", () => {
	const cases = [
		{ name: "missing code", query: "" },
		{ name: "empty code", query: "?code=" },
		{ name: "path traversal", query: "?code=../x" },
		{ name: "too long", query: `?code=${"A".repeat(51)}` },
	];

	for (const { name, query } of cases) {
		test(name, async ({ request }) => {
			const response = await getThroughEdge(
				request,
				`/api/imaging/badge${query}`,
			);
			expect(response.status()).toBe(400);
		});
	}
});

test("the badge preflight advertises GET", async ({ request }) => {
	const response = await fetchThroughEdge(
		request,
		"/api/imaging/badge?code=ADM",
		{
			method: "OPTIONS",
		},
	);
	expect(response.status()).toBe(204);
	expect(response.headers()["access-control-allow-methods"]).toContain("GET");
});
