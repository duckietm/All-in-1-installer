import { expect, test } from "@playwright/test";

// Read-only production checks. Content mutation tests belong to a seeded staging DB.
test("login remains usable on a narrow viewport", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 720 });
	const response = await page.goto("/login");
	expect(response?.ok()).toBe(true);
	await expect(page.locator('input[type="password"]').first()).toBeVisible();
	await expect(page.locator('button[type="submit"]').first()).toBeVisible();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth + 1,
		),
	).toBe(true);
	await expect(page.locator("body")).not.toContainText("Application error");
});
test("public news is rendered without a server error", async ({ page }) => {
	const response = await page.goto("/news");
	expect(response?.ok()).toBe(true);
	await expect(page.locator("main").first()).toBeVisible();
	await expect(page.locator("body")).not.toContainText("Application error");
});
test("staff page is available", async ({ page }) => {
	const response = await page.goto("/staff");
	expect(response?.ok()).toBe(true);
	await expect(page.locator("main").first()).toBeVisible();
});
