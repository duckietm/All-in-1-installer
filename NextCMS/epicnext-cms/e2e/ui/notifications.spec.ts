import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw error;
	});
});

test("notification reads persist, new replies are unread and failed preferences stay unchanged", async ({
	page,
}) => {
	let key = "support:42";
	const readKeys = new Set<string>();
	let fail = false;
	await page.route("**/cms_api/notifications**", async (route) => {
		if (route.request().method() === "POST") {
			if (fail)
				return route.fulfill({ status: 503, json: { error: "Unavailable" } });
			const body = route.request().postDataJSON();
			if (body.action === "read") readKeys.add(body.key);
			return route.fulfill({ json: { ok: true } });
		}
		return route.fulfill({
			json: {
				items: [
					{
						key,
						category: "support",
						title: "Your account request",
						href: "/help/tickets/2",
						occurredAt: "2030-01-01T12:00:00Z",
						read: readKeys.has(key),
					},
				],
				page: 1,
				pages: 1,
				unread: readKeys.has(key) ? 0 : 1,
				preferences: { support: true, friends: true, events: true },
			},
		});
	});
	await page.goto("/notifications");
	const mark = page.getByRole("button", { name: "Mark as read" });
	await expect(mark).toBeVisible();
	await mark.focus();
	await expect(mark).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(mark).toHaveCount(0);
	await page.reload();
	await expect(
		page.getByText("No unread notifications", { exact: true }),
	).toBeVisible();
	key = "support:43";
	await page.reload();
	await expect(mark).toBeVisible();
	fail = true;
	await mark.click();
	await expect(page.getByRole("alert")).toHaveText(
		"The change could not be saved. Please try again.",
	);
	await expect(mark).toBeVisible();
	const support = page.getByRole("checkbox", { name: "Support replies" });
	await support.click();
	await expect(support).toBeChecked();
	expect(await support.evaluate((el) => getComputedStyle(el).color)).not.toBe(
		"rgba(0, 0, 0, 0)",
	);
	expect(
		await support.evaluate((el) => getComputedStyle(el).backgroundColor),
	).not.toBe("rgba(0, 0, 0, 0)");
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await page.screenshot({
		path: `test-results/notifications-${test.info().project.name}.png`,
		fullPage: true,
	});
});

test("notification service failure offers a retry and recovers to empty state", async ({
	page,
}) => {
	let failing = true;
	await page.route("**/cms_api/notifications**", (route) =>
		route.fulfill(
			failing
				? { status: 503, json: { error: "Unavailable" } }
				: {
						json: {
							items: [],
							page: 1,
							pages: 1,
							unread: 0,
							preferences: { support: true, friends: true, events: true },
						},
					},
		),
	);
	await page.goto("/notifications");
	await expect(page.getByRole("alert")).toHaveText(
		"Notifications are temporarily unavailable.",
	);
	failing = false;
	await page.getByRole("button", { name: "Try again" }).click();
	await expect(
		page.getByText("No notifications in your enabled categories."),
	).toBeVisible();
});

test("category changes persist and pagination recovers when filtering shrinks the feed", async ({
	page,
}) => {
	let enabled = true;
	await page.route("**/cms_api/notifications**", async (route) => {
		if (route.request().method() === "POST") {
			enabled = route.request().postDataJSON().preferences.support;
			return route.fulfill({ json: { ok: true } });
		}
		const requested = Number(
			new URL(route.request().url()).searchParams.get("page") ?? 1,
		);
		const current = enabled ? Math.min(2, requested) : 1;
		return route.fulfill({
			json: {
				items: enabled
					? [
							{
								key: `support:${current}`,
								category: "support",
								title: `Reply page ${current}`,
								href: "/help/tickets/2",
								occurredAt: null,
								read: false,
							},
						]
					: [],
				page: current,
				pages: enabled ? 2 : 1,
				unread: enabled ? 21 : 0,
				preferences: { support: enabled, friends: true, events: true },
			},
		});
	});
	await page.goto("/notifications");
	await page.getByRole("button", { name: "Next", exact: true }).click();
	await expect(page.getByRole("link", { name: "Reply page 2" })).toBeVisible();
	const support = page.getByRole("checkbox", { name: "Support replies" });
	await support.click();
	await expect(support).not.toBeChecked();
	await expect(
		page.getByText("No notifications in your enabled categories."),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Next", exact: true }),
	).toHaveCount(0);
	await page.reload();
	await expect(support).not.toBeChecked();
	await support.click();
	await expect(page.getByRole("link", { name: "Reply page 1" })).toBeVisible();
});
