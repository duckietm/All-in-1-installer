import { expect, test } from "@playwright/test";
import { countBytes, FIGURE, IS_EDGE, looksLikeImage } from "./imaging-target";

// These assertions only hold when the CMS itself answers `/imaging`. In
// production the edge proxy fronts bare `/imaging` (and `/imaging/*`) to the
// imager container, so the CMS route is shadowed; set `IMAGING_EDGE=1` to skip.
test.skip(
	IS_EDGE,
	"The CMS /imaging route is shadowed by the edge proxy in production",
);

const imagerPath = (params: Record<string, string> = {}) =>
	`/imaging?${new URLSearchParams({ figure: FIGURE, img_format: "png", ...params })}`;

const PNG_MAGIC = Buffer.from("89504e470d0a1a0a", "hex");

test("serves the default render as a PNG", async ({ request }) => {
	const response = await request.get(imagerPath());
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toContain("image/png");
	const body = await response.body();
	expect(body.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
	expect(looksLikeImage(body)).toBe(true);
});

test("transcodes to WebP on request", async ({ request }) => {
	const response = await request.get(imagerPath({ format: "webp" }));
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toContain("image/webp");
	const body = await response.body();
	expect(body.subarray(0, 4).toString("ascii")).toBe("RIFF");
	expect(body.subarray(8, 12).toString("ascii")).toBe("WEBP");
});

test("transcodes to AVIF on request", async ({ request }) => {
	const response = await request.get(imagerPath({ format: "avif" }));
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toContain("image/avif");
	const body = await response.body();
	expect(body.subarray(4, 12).toString("ascii")).toBe("ftypavif");
});

test("leaves animated APNG renders untranscoded", async ({ request }) => {
	// The renderer emits effected avatars as APNG; libvips here reads only the
	// first frame, so the animated original must be served as-is even when a
	// transcode is requested — otherwise the avatar would stop animating.
	const response = await request.get(
		imagerPath({ img_format: "apng", effect: "14", format: "webp" }),
	);
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toContain("image/png");

	const body = await response.body();
	expect(body.includes(Buffer.from("acTL"))).toBe(true);
	expect(countBytes(body, Buffer.from("fcTL"))).toBeGreaterThan(1);
});

test("advertises long-lived edge caching", async ({ request }) => {
	const response = await request.get(imagerPath());
	expect(response.status()).toBe(200);
	const cacheControl = response.headers()["cache-control"] ?? "";
	expect(cacheControl).toContain("public");
	expect(cacheControl).toContain("s-maxage");
	expect(cacheControl).toContain("stale-while-revalidate");
});

test("rejects a malformed figure with 400", async ({ request }) => {
	const response = await request.get(
		`/imaging?figure=${encodeURIComponent("../bad")}`,
	);
	expect(response.status()).toBe(400);
});

test("the imager preflight advertises GET", async ({ request }) => {
	const response = await request.fetch("/imaging", { method: "OPTIONS" });
	expect(response.status()).toBe(204);
	expect(response.headers()["access-control-allow-methods"]).toContain("GET");
});
