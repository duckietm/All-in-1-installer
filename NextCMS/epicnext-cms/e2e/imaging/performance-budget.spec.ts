import { expect, test } from "@playwright/test";
import { avatarPath } from "./imaging-target";

// Lightweight size/latency budget for the avatar path. The endpoint spec checks
// correctness; this one catches a regression that keeps the image correct but
// makes it oversized or slow — e.g. losing the disk/edge cache and re-encoding
// (or re-rendering) on every hit. Budgets are deliberately loose: they should
// flag a real regression, not a cold cache or a slow CI network.
const STATIC_MAX_BYTES = 64 * 1024;
const ANIMATED_MAX_BYTES = 512 * 1024;
const WARM_MAX_MS = 3000;

test("the static avatar stays inside its byte budget", async ({ request }) => {
	const response = await request.get(avatarPath({ img_format: "png" }));
	expect(response.status()).toBe(200);
	expect((await response.body()).length).toBeLessThanOrEqual(STATIC_MAX_BYTES);
});

test("the animated avatar stays inside its byte budget", async ({
	request,
}) => {
	const response = await request.get(
		avatarPath({ img_format: "apng", effect: "14" }),
	);
	expect(response.status()).toBe(200);
	expect((await response.body()).length).toBeLessThanOrEqual(
		ANIMATED_MAX_BYTES,
	);
});

test("a warm avatar request is served quickly", async ({ request }) => {
	const path = avatarPath({ img_format: "png" });
	await request.get(path); // warm the disk and edge caches
	const started = Date.now();
	const response = await request.get(path);
	const elapsed = Date.now() - started;
	expect([200, 304]).toContain(response.status());
	expect(elapsed).toBeLessThan(WARM_MAX_MS);
});
