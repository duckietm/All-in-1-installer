import { expect, type Page } from "@playwright/test";

/**
 * Shared assertions for the read-only public e2e suite. These specs run against
 * a live CMS (see `playwright.config.ts`) and must never mutate data — they
 * guard the "everything loads, nothing is broken" contract that no unit test
 * can see.
 */

/** Fails if Next rendered a runtime/server error boundary into the page. */
export async function expectNoApplicationError(page: Page) {
	await expect(page.locator("body")).not.toContainText("Application error");
	await expect(page.locator("body")).not.toContainText("Internal Server Error");
}

/**
 * Every <img> that finished loading must have decoded pixels. A failed request
 * (404, broken CMS media, bad avatar figure) reports `complete === true` with
 * `naturalWidth === 0`, which is what this catches. Intentionally lazy images
 * that are still pending (`complete === false`) are ignored.
 */
export async function expectNoBrokenImages(page: Page) {
	const broken = await page.evaluate(() => {
		return Array.from(document.images)
			.filter((img) => {
				const src = img.currentSrc || img.src;
				if (!src || src.startsWith("data:")) return false;
				return img.complete && img.naturalWidth === 0;
			})
			.map((img) => img.currentSrc || img.src);
	});
	expect(broken, `broken images:\n${broken.join("\n")}`).toEqual([]);
}

/** No horizontal scrollbar — the classic mobile layout regression. */
export async function expectNoHorizontalOverflow(page: Page) {
	const overflowing = await page.evaluate(() => {
		const doc = document.documentElement;
		return doc.scrollWidth > window.innerWidth + 1;
	});
	expect(overflowing, "page scrolls horizontally").toBe(false);
}

/**
 * Walks the page top-to-bottom so `loading="lazy"` images below the fold get a
 * chance to start before the broken-image check runs.
 */
export async function scrollThroughPage(page: Page) {
	await page.evaluate(async () => {
		const step = window.innerHeight;
		for (let y = 0; y < document.body.scrollHeight; y += step) {
			window.scrollTo(0, y);
			await new Promise((resolve) => setTimeout(resolve, 80));
		}
		window.scrollTo(0, 0);
	});
}

/** Skips a spec when the CMS answered with a maintenance redirect. */
export function isMaintenanceRedirect(url: string) {
	return /\/maintenance(?:$|[/?])/.test(url);
}
