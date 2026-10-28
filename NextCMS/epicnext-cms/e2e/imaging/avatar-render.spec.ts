import { expect, test } from "@playwright/test";
import { avatarPath } from "./imaging-target";

/**
 * Cross-browser check that a real browser (chromium/firefox/webkit) can decode
 * the avatar the imager produces and that it actually animates. The endpoint
 * spec covers the HTTP contract; this one covers the client-side decode, where
 * an unsupported image format would surface as a blank/broken avatar.
 *
 * Navigates straight to the image URL (a top-level navigation, which CSP
 * `upgrade-insecure-requests` does not rewrite) rather than embedding it in a
 * page: over a plain-HTTP host the upgrade directive would otherwise send the
 * subresource request to https and break the load, without exercising anything
 * about the image itself.
 *
 * Run across engines via `pnpm test:imaging` (playwright.imaging.config.ts).
 */
const ANIMATED = avatarPath({ img_format: "apng", effect: "14" });
const STATIC = avatarPath({ img_format: "png" });

test("the avatar decodes and animates in the browser", async ({ page }) => {
	const response = await page.goto(ANIMATED);
	expect(response?.status()).toBe(200);

	const image = page.locator("img");
	await expect(image).toBeVisible();
	const decoded = await image.evaluate((element: HTMLImageElement) => ({
		width: element.naturalWidth,
		height: element.naturalHeight,
	}));
	expect(decoded.width).toBeGreaterThan(0);
	expect(decoded.height).toBeGreaterThan(0);

	// An animated APNG keeps producing new frames; a static/undecodable one
	// yields the same pixels every time. Sampling screenshots over a second is
	// enough to tell them apart without depending on exact frame timing.
	const frames = new Set<string>();
	for (let attempt = 0; attempt < 8; attempt += 1) {
		frames.add((await image.screenshot()).toString("base64"));
		await page.waitForTimeout(180);
	}
	expect(frames.size).toBeGreaterThan(1);
});

test("the static render matches its committed visual baseline", async ({
	page,
}) => {
	// Pins the exact pixels of a non-animated render so a renderer/asset drift
	// (wrong palette, missing part, changed sizing) is caught even when the
	// image still decodes. Baselines are per engine and committed under
	// e2e/imaging/__screenshots__/.
	const response = await page.goto(STATIC);
	expect(response?.status()).toBe(200);
	await expect(page.locator("img")).toHaveScreenshot("static-avatar.png", {
		animations: "disabled",
	});
});
