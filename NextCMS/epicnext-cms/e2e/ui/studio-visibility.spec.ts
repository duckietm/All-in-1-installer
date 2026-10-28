import { expect, test } from "@playwright/test";

/**
 * The furniture pane once declared `initial={{ opacity: 0 }}` / `animate={{
 * opacity: 1 }}` through motion's minimal `motion/react-m` entry. That entry
 * renders the element but never runs the animation, so the inline style stayed
 * at opacity: 0: every row was in the DOM, measurable, and its image loaded,
 * yet the whole list was invisible.
 *
 * studio.spec.ts could not catch it because playwright.ui.config.ts sets
 * `reducedMotion: "reduce"`, and under reduced motion the animation is skipped
 * and the element lands straight on its final value. This file opts out of that
 * so a future animation swap cannot quietly hide the list again.
 */

const items = [
	{
		id: 1,
		classname: "fixture_chair",
		name: "Fixture chair",
		description: "Synthetic chair",
		type: "flooritem",
		revision: 1,
		category: "other",
		alreadyImported: true,
		nitroExists: true,
		iconUrl: "/fixture/cover.svg",
	},
	{
		id: 2,
		classname: "fixture_table",
		name: "Fixture table",
		description: "Synthetic table",
		type: "flooritem",
		revision: 1,
		category: "other",
		alreadyImported: false,
		nitroExists: false,
		iconUrl: "/fixture/cover.svg",
	},
];

test("the furniture pane is painted, not merely present in the DOM", async ({
	browser,
}) => {
	const context = await browser.newContext({
		reducedMotion: "no-preference",
		viewport: { width: 1440, height: 900 },
	});
	const page = await context.newPage();

	await page.route("**/cms_api/**", async (route) => {
		const request = route.request();
		const url = new URL(request.url());

		if (url.pathname === "/cms_api/admin/import/furni") {
			return route.fulfill({
				json:
					url.searchParams.get("action") === "stats"
						? { totalInDb: 2, inCatalog: 1, notInCatalog: 1, missingNitro: 0 }
						: {
								items,
								meta: { currentPage: 1, lastPage: 1, total: 2, perPage: 20 },
							},
			});
		}
		if (url.pathname === "/cms_api/admin/import/clone")
			return route.fulfill({ json: { sources: [] } });
		if (url.pathname === "/cms_api/admin/studio/import-jobs")
			return route.fulfill({ json: { ok: true, jobs: [], nextCursor: null } });
		if (url.pathname === "/cms_api/admin/studio/nitro-quality")
			return route.fulfill({
				json: {
					report: {
						scales: [32, 64].map((size) => ({
							size,
							state: "missing",
							assets: [],
							animations: [],
							directions: [],
							issues: [],
						})),
					},
				},
			});
		return route.fulfill({
			status: 404,
			json: { error: "Unknown fixture endpoint" },
		});
	});

	await page.goto("/admin/studio-harness", { waitUntil: "domcontentloaded" });

	const list = page.locator('[data-testid="studio-furniture-list"]');
	await expect(list).toBeVisible();

	await expect
		.poll(async () => list.locator("[data-index]").count(), { timeout: 20000 })
		.toBeGreaterThan(0);
	// Let any entrance animation run before sampling computed styles.
	await page.waitForTimeout(1000);

	// The rows exist. Now prove they are actually painted: no ancestor may be
	// left faded out, which is precisely the failure this guards against.
	const samples = await list.locator("[data-index]").evaluateAll((els) =>
		els.slice(0, 5).map((el) => {
			const opacities: number[] = [];
			let node: Element | null = el;
			while (node && opacities.length < 12) {
				opacities.push(Number(getComputedStyle(node).opacity));
				node = node.parentElement;
			}
			const rect = el.getBoundingClientRect();
			return {
				minOpacity: Math.min(...opacities),
				width: rect.width,
				height: rect.height,
			};
		}),
	);

	expect(samples.length).toBeGreaterThan(0);
	for (const s of samples) {
		expect(s.minOpacity, "an ancestor is faded out").toBeGreaterThan(0.9);
		expect(s.width).toBeGreaterThan(0);
		expect(s.height).toBeGreaterThan(0);
	}

	// Playwright treats opacity 0 as not visible, so this is the end-to-end form.
	await expect(list.locator("[data-index]").first()).toBeVisible();
	await expect(
		page.getByRole("button", { name: "View Fixture chair", exact: true }),
	).toBeVisible();

	await context.close();
});
