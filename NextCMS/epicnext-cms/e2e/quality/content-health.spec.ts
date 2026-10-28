import { expect, test } from "@playwright/test";
import {
	expectNoApplicationError,
	expectNoBrokenImages,
	expectNoHorizontalOverflow,
	isMaintenanceRedirect,
	scrollThroughPage,
} from "../helpers";

// ADVISORY suite — run with `pnpm test:e2e:quality`, not part of the deploy
// gate. These checks depend on live content/upload state and user data (a
// missing upload, a legacy malformed avatar figure, a bad theme asset), so
// they are informational: they tell you the site has a real content problem,
// but they must never block a code deploy. Every assertion the CMS can
// guarantee on its own lives in the blocking specs instead.
const PUBLIC_ROUTES = [
	"/",
	"/news",
	"/staff",
	"/shop",
	"/search",
	"/leaderboard",
	"/help",
	"/radio",
] as const;

for (const route of PUBLIC_ROUTES) {
	test(`${route} loads every image and does not overflow`, async ({ page }) => {
		const response = await page.goto(route);
		expect(response?.ok(), `GET ${route} -> ${response?.status()}`).toBe(true);

		await expect(page.locator("main").first()).toBeVisible();
		await expectNoApplicationError(page);

		await scrollThroughPage(page);
		await expectNoBrokenImages(page);
		await expectNoHorizontalOverflow(page);
	});
}

test("the register page loads its theme/avatar images", async ({ page }) => {
	const response = await page.goto("/register");
	test.skip(
		isMaintenanceRedirect(page.url()) || response?.status() === 404,
		"register is not reachable on this deploy",
	);
	await scrollThroughPage(page);
	await expectNoBrokenImages(page);
	await expectNoHorizontalOverflow(page);
});

test("the homepage stays usable on a narrow viewport", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const response = await page.goto("/");
	expect(response?.ok()).toBe(true);
	await expectNoApplicationError(page);
	await expectNoHorizontalOverflow(page);
});
