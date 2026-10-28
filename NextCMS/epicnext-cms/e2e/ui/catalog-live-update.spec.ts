import { expect, type Page, test } from "@playwright/test";

/**
 * The guarantee this file exists to guard: an import that finishes outside this
 * page — the job worker, another tab, another browser — puts the new categories
 * on screen without a reload. Every earlier test in this suite asserted only
 * that no page errors were thrown, so a regression back to "refresh the page to
 * see it" would have gone unnoticed.
 */

function node(id: number, caption: string, itemCount = 0) {
	return {
		id,
		caption,
		parentId: -1,
		depth: 0,
		orderNum: id,
		enabled: "1",
		visible: "1",
		iconImage: 0,
		iconColor: 0,
		pageLayout: "default_3x3",
		childCount: 0,
		itemCount,
	};
}

/** The catalog as the server would report it; specs move it forward mid-test. */
const catalog = {
	revision: "rev-1",
	pages: [node(1, "Root")],
	treeStatus: 200,
};

async function mockStudio(page: Page) {
	await page.route("**/api/**", async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname === "/api/admin/catalog/revision")
			return route.fulfill({ json: { ok: true, revision: catalog.revision } });
		if (
			url.pathname === "/api/admin/catalog/tree" &&
			url.searchParams.get("mode") === "full"
		)
			return route.fulfill({
				status: catalog.treeStatus,
				json: {
					ok: catalog.treeStatus === 200,
					pages: catalog.pages,
					totals: null,
					revision: catalog.revision,
				},
			});
		if (url.pathname.endsWith("/inspect"))
			return route.fulfill({ json: { items: [] } });
		if (url.pathname.endsWith("/source-assets"))
			return route.fulfill({ json: { items: [] } });
		if (url.pathname.endsWith("/furni"))
			return route.fulfill({
				json: url.searchParams.has("action")
					? { totalInDb: 0, inCatalog: 0, notInCatalog: 0, missingNitro: 0 }
					: {
							items: [],
							meta: {
								currentPage: 1,
								lastPage: 1,
								total: 0,
								perPage: 100,
							},
						},
			});
		if (url.pathname.endsWith("/clone"))
			return route.fulfill({ json: { sources: [] } });
		if (url.pathname.endsWith("/import-jobs"))
			return route.fulfill({ json: { ok: true, jobs: [], nextCursor: null } });
		return route.fulfill({
			status: 404,
			json: { error: "Unknown fixture endpoint" },
		});
	});
}

test.beforeEach(() => {
	catalog.revision = "rev-1";
	catalog.pages = [node(1, "Root")];
	catalog.treeStatus = 200;
});

test("a write announced by another tab lands in the mounted categories", async ({
	page,
}, testInfo) => {
	test.skip(
		(testInfo.project.use.viewport?.width ?? 0) < 1024,
		"the category rail is collapsed on narrow viewports",
	);
	await mockStudio(page);
	const navigations: string[] = [];
	page.on("framenavigated", (frame) => {
		if (frame === page.mainFrame()) navigations.push(frame.url());
	});

	await page.goto("/admin/studio-harness");
	await expect(page.getByRole("button", { name: /^Root/ })).toBeVisible();
	const navigationsAfterLoad = navigations.length;

	// An import finished elsewhere: the catalog moved on, so the tree route now
	// answers with the imported category.
	catalog.revision = "rev-2";
	catalog.pages = [...catalog.pages, node(2, "Imported Furniture", 3)];
	await page.evaluate((revision) => {
		const channel = new BroadcastChannel("atom-cms-catalog");
		channel.postMessage({ revision });
		channel.close();
	}, catalog.revision);

	await expect(
		page.getByRole("button", { name: /Imported Furniture/ }),
	).toBeVisible();
	// The page was never navigated or reloaded: the tree updated in place.
	expect(navigations).toHaveLength(navigationsAfterLoad);
});

test("a failed refresh keeps the categories and says it is stale", async ({
	page,
}, testInfo) => {
	test.skip(
		(testInfo.project.use.viewport?.width ?? 0) < 1024,
		"the category rail is collapsed on narrow viewports",
	);
	await mockStudio(page);
	await page.goto("/admin/studio-harness");
	await expect(page.getByRole("button", { name: /^Root/ })).toBeVisible();

	catalog.treeStatus = 500;
	catalog.revision = "rev-2";
	await page.evaluate((revision) => {
		const channel = new BroadcastChannel("atom-cms-catalog");
		channel.postMessage({ revision });
		channel.close();
	}, catalog.revision);

	await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
	await expect(page.getByRole("button", { name: /^Root/ })).toBeVisible();
});
