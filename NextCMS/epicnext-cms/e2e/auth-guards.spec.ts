import { expect, test } from "@playwright/test";
import { expectNoApplicationError } from "./helpers";

// Unauthenticated requests to private routes must bounce to the login form —
// never render private content and never 500. Two guard paths exist: the edge
// proxy rewrites `/admin/*` to `/login?from=…` (`src/proxy.ts`), while the
// member pages and the mod console redirect from their layouts with a bare
// `/login`.

// Routes where the proxy preserves the requested destination.
const PROXY_ROUTES = ["/admin", "/admin/settings"] as const;
// Routes guarded by a page/layout `redirect("/login")` with no destination.
const LAYOUT_ROUTES = [
	"/settings",
	"/me",
	"/messages",
	"/notifications",
	"/friends",
	"/redeem",
	"/mod",
	"/client",
] as const;

for (const route of PROXY_ROUTES) {
	test(`${route} redirects to login and keeps the return path`, async ({
		page,
	}) => {
		const response = await page.goto(route);
		expect(response?.ok(), `GET ${route} -> ${response?.status()}`).toBe(true);
		await expect(page).toHaveURL(/\/login/);
		await expect(page.locator('input[type="password"]').first()).toBeVisible();
		await expectNoApplicationError(page);

		const from = new URL(page.url()).searchParams.get("from");
		expect(from, "login lost the return destination").toBeTruthy();
		expect(new URL(from as string, "http://localhost").pathname).toBe(route);
	});
}

for (const route of LAYOUT_ROUTES) {
	test(`${route} redirects an anonymous visitor to login`, async ({ page }) => {
		const response = await page.goto(route);
		expect(response?.ok(), `GET ${route} -> ${response?.status()}`).toBe(true);
		await expect(page).toHaveURL(/\/login/);
		await expect(page.locator('input[type="password"]').first()).toBeVisible();
		await expectNoApplicationError(page);
	});
}
