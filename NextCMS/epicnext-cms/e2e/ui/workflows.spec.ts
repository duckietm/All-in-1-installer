import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";

type Fixtures = { visualSnapshots: boolean };

// Visual baselines are committed for Chromium only; Firefox and WebKit are
// excluded because their pixel output is not expected to match the Chromium
// baselines. Functional and accessibility assertions still run everywhere.
const test = base.extend<Fixtures>({
	visualSnapshots: async ({ browserName }, use) => {
		await use(browserName === "chromium");
	},
});

async function accessible(page: Page, sandboxPreview = false) {
	// WebKit can briefly report stale colors (e.g. dark-on-dark contrast)
	// right after interactions while style invalidation settles, so poll
	// until the audit is clean or the timeout expires.
	await expect
		.poll(
			async () => {
				const builder = new AxeBuilder({ page });
				// A sandbox without allow-scripts cannot run axe; its accessible name is asserted separately.
				if (sandboxPreview) builder.exclude("iframe[sandbox]");
				const result = await builder
					.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
					.analyze();
				return result.violations.map(({ id, impact, nodes }) => ({
					id,
					impact,
					nodes: nodes.map((node) => ({
						target: node.target,
						summary: node.failureSummary,
					})),
				}));
			},
			{ timeout: 15000 },
		)
		.toEqual([]);
}

test.beforeEach(async ({ page, baseURL, request }) => {
	await request.post("/fixture/reset");
	await page.clock.setFixedTime(new Date("2030-01-01T12:00:00Z"));
	await page.route("**/*", (route) =>
		new URL(route.request().url()).origin === baseURL
			? route.continue()
			: route.abort(),
	);
	page.on("pageerror", (error) => {
		throw error;
	});
});

test("settings switches have names and remain keyboard operable", async ({
	page,
	visualSnapshots,
}) => {
	await page.goto("/admin/settings");
	const toggle = page.getByRole("switch", {
		name: "Dark mode by default",
		exact: true,
	});
	await expect(toggle).not.toBeChecked();
	await toggle.focus();
	await page.keyboard.press("Space");
	await expect(toggle).toBeChecked();
	await accessible(page);
	if (visualSnapshots) {
		const group = page.locator("section").filter({ has: toggle });
		await expect(group).toHaveScreenshot("settings-switches.png");
	}
	const response = page.waitForResponse((response) =>
		response.url().endsWith("/fixture/actions/settings"),
	);
	await page
		.getByRole("button", { name: "Save settings", exact: true })
		.click();
	expect((await response).ok()).toBe(true);
	await expect(
		page.getByRole("button", { name: "Save settings", exact: true }),
	).toBeDisabled();
});

test("article form and preview dialog pass accessibility with focus return", async ({
	page,
	visualSnapshots,
}) => {
	await page.goto("/admin/articles/new");
	await expect(page.locator("iframe.tox-edit-area__iframe")).toBeVisible();
	await expect
		.poll(() =>
			page
				.locator("form")
				.evaluate((form) => form.scrollWidth <= form.clientWidth),
		)
		.toBe(true);
	await accessible(page);
	await page.locator('input[name="title"]').fill("Accessible community update");
	const preview = page.getByRole("button", { name: "Preview", exact: true });
	await preview.click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveAccessibleName("Article preview");
	await expect(dialog.locator("iframe")).toHaveAttribute("title", /.+/);
	await accessible(page, true);
	if (visualSnapshots) {
		await expect(dialog).toHaveScreenshot("article-preview.png");
	}
	// Keyboard events inside the sandbox do not bubble to the parent dialog.
	// Wait until the dialog transferred focus to the preview iframe, then Tab
	// must move focus to the dialog's Close button. Firefox can swallow a Tab
	// while the sandboxed srcdoc frame is still loading, so retry until the
	// focus lands where it belongs instead of racing the frame load.
	const previewFrame = dialog.locator("iframe");
	await expect(previewFrame).toBeFocused();
	const closeButton = dialog.getByRole("button", {
		name: "Close",
		exact: true,
	});
	await expect
		.poll(async () => {
			await page.keyboard.press("Tab");
			return closeButton.evaluate((el) => el === document.activeElement);
		})
		.toBe(true);
	await expect(closeButton).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
	await expect(preview).toBeFocused();
	if (visualSnapshots) {
		await expect(page.getByRole("main")).toHaveScreenshot("article-form.png");
	}
});

test("support table filters and saved-view popover stay accessible", async ({
	page,
	visualSnapshots,
}) => {
	await page.goto("/admin/tickets/desk");
	await expect(
		page.getByRole("link", { name: "Account assistance" }),
	).toBeVisible();
	await accessible(page);
	if (visualSnapshots) {
		await expect(page.getByRole("main")).toHaveScreenshot("ticket-table.png");
	}
	await page
		.getByRole("button", { name: "Assigned to me", exact: true })
		.click();
	await expect(page).toHaveURL(/filter_assignee=mine/);
	await page.getByRole("button", { name: "Saved views", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "View name" })).toBeVisible();
	await accessible(page);
	if (visualSnapshots) {
		await expect(page.getByRole("main")).toHaveScreenshot(
			"ticket-saved-views.png",
		);
	}
});

test("queued synchronization survives reload without duplicate submission", async ({
	page,
	visualSnapshots,
}) => {
	await page.goto("/admin/import/official");
	const requests: string[] = [];
	page.on("request", (request) => {
		if (request.method() === "POST" && request.url().endsWith("/sync-all"))
			requests.push(request.postData() || "");
	});
	await page
		.getByRole("button", { name: "Start synchronization", exact: true })
		.dblclick();
	await expect(
		page.getByRole("status").filter({ hasText: "Synchronization saved" }),
	).toBeVisible();
	expect(requests).toHaveLength(1);
	await page.reload();
	await page.locator("details details > summary").first().click();
	await expect(page.getByText("fixture_chair", { exact: true })).toBeVisible();
	await accessible(page);
	if (visualSnapshots) {
		await expect(page.getByRole("main")).toHaveScreenshot("sync-history.png");
	}
});

test("article editor fits a narrow mobile card without horizontal overflow", async ({
	page,
}) => {
	await page.setViewportSize({ width: 360, height: 844 });
	await page.goto("/admin/articles/new");
	await expect(page.locator("iframe.tox-edit-area__iframe")).toBeVisible();
	await expect
		.poll(() =>
			page
				.locator("form")
				.evaluate((form) => form.scrollWidth <= form.clientWidth),
		)
		.toBe(true);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					document.documentElement.scrollWidth <=
					document.documentElement.clientWidth,
			),
		)
		.toBe(true);
});
