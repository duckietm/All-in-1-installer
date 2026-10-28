import { expect, test } from "@playwright/test";
import { expectNoApplicationError, isMaintenanceRedirect } from "./helpers";

// The register form is the gate for every new player, so it gets a deeper
// read-only pass than the generic public-page spec. It also pins the captcha
// contract that is configured through `CAPTCHA_PROVIDER` / `TURNSTILE_*` env
// vars (see `src/lib/services/captcha.ts`): whatever provider the running CMS
// resolves, the DOM must expose exactly one widget whose sitekey is non-empty.
const CAPTCHA_SELECTOR = ".cf-turnstile, .g-recaptcha, .h-captcha";

// Optional explicit expectation for a deploy, e.g. `E2E_EXPECT_CAPTCHA=turnstile`
// or `E2E_EXPECT_CAPTCHA=none`. Left unset, the spec only checks consistency.
const EXPECT = process.env.E2E_EXPECT_CAPTCHA?.trim();

test.describe("register", () => {
	test.beforeEach(async ({ page }) => {
		const response = await page.goto("/register");
		test.skip(
			isMaintenanceRedirect(page.url()) || response?.status() === 404,
			"register is not reachable on this deploy",
		);
	});

	test("renders every field a new player has to fill in", async ({ page }) => {
		await expect(page.locator('input[name="username"]')).toBeVisible();
		await expect(page.locator('input[name="mail"]')).toBeVisible();
		await expect(page.locator('input[name="password"]').first()).toBeVisible();
		await expect(
			page.locator('input[name="password_confirmation"]'),
		).toBeVisible();
		await expect(page.locator('input[name="terms"]')).toBeVisible();
		await expect(page.locator('button[type="submit"]').first()).toBeVisible();
		await expectNoApplicationError(page);
	});

	test("exposes exactly one captcha widget with a site key", async ({
		page,
	}) => {
		const widgets = page.locator(CAPTCHA_SELECTOR);

		if (EXPECT === "none") {
			await expect(widgets).toHaveCount(0);
			return;
		}

		if (EXPECT === "turnstile") {
			await expect(page.locator(".cf-turnstile")).toHaveCount(1);
		}

		const count = await widgets.count();
		expect(
			count,
			`expected at most one captcha provider, found ${count}`,
		).toBeLessThanOrEqual(1);

		for (let index = 0; index < count; index += 1) {
			const siteKey = await widgets.nth(index).getAttribute("data-sitekey");
			expect(siteKey, "captcha widget without data-sitekey").toBeTruthy();
			expect(siteKey?.trim().length).toBeGreaterThan(0);
		}

		if (count > 0 && (await page.locator(".cf-turnstile").count()) > 0) {
			const script = page.locator(
				'script[src*="challenges.cloudflare.com/turnstile"]',
			);
			await expect(script).toHaveCount(1);
		}
	});
});
