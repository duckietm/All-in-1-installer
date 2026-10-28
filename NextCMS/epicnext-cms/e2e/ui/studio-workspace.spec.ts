import { expect, type Page, test } from "@playwright/test";

const items = Array.from({ length: 60 }, (_, index) => ({
	id: index + 1,
	classname: `chair_${index}`,
	name: `Chair ${index}`,
	description: "Fixture furniture",
	type: "flooritem",
	revision: 1,
	category: "other",
	alreadyImported: false,
	nitroExists: false,
	iconUrl: "/fixture/cover.svg",
}));
async function mockStudio(page: Page) {
	await page.route("**/cms_api/**", async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname.endsWith("/inspect"))
			return route.fulfill({
				json: {
					items: (route.request().postDataJSON().classnames as string[]).map(
						(classname) => ({
							classname,
							sql: [{ id: 1, spriteId: 1, name: "Chair", type: "s" }],
							catalog: [],
							furnidata: [],
							furnidataReadable: true,
							nitro: { exists: true, bytes: 42 },
							icon: { exists: false, bytes: 0 },
						}),
					),
				},
			});
		if (url.pathname.endsWith("/source-assets"))
			return route.fulfill({ json: { items: [] } });
		if (url.pathname.endsWith("/furni"))
			return route.fulfill({
				json: url.searchParams.has("action")
					? { totalInDb: 0, inCatalog: 0, notInCatalog: 0, missingNitro: 0 }
					: {
							items,
							meta: {
								currentPage: 1,
								lastPage: 1,
								total: items.length,
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
test("closing furniture restores its scroll, focus, search, filter and selection", async ({
	page,
}) => {
	await mockStudio(page);
	await page.goto("/admin/studio-harness");
	await page.getByRole("textbox", { name: "Search furniture" }).fill("chair");
	await page.waitForResponse(
		(res) => new URL(res.url()).searchParams.get("search") === "chair",
	);
	await page.getByRole("combobox", { name: "Furniture type" }).click();
	await page.getByRole("option", { name: "Floor items", exact: true }).click();
	const trigger = page.getByRole("button", {
		name: "View Chair 30",
		exact: true,
	});
	await trigger.scrollIntoViewIfNeeded();
	await page
		.getByRole("checkbox", { name: "Select chair_30", exact: true })
		.check();
	const list = page.getByTestId("studio-furniture-list");
	const top = await list.evaluate((element) => element.scrollTop);
	await trigger.click();
	await page
		.getByRole("button", { name: "Close furniture details", exact: true })
		.click();
	await expect(trigger).toBeFocused();
	expect(await list.evaluate((element) => element.scrollTop)).toBe(top);
	await expect(
		page.getByRole("textbox", { name: "Search furniture" }),
	).toHaveValue("chair");
	await expect(
		page.getByRole("combobox", { name: "Furniture type" }),
	).toContainText("Floor");
	await expect(
		page.getByRole("checkbox", { name: "Select chair_30", exact: true }),
	).toBeChecked();
	await trigger.click();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: "Close furniture details", exact: true }),
	).toHaveCount(0);
	await expect(trigger).toBeFocused();
	await expect(
		page.getByRole("checkbox", { name: "Select chair_30", exact: true }),
	).toBeChecked();
});
test("review proposes completing existing furniture and filters actionable groups", async ({
	page,
}) => {
	await mockStudio(page);
	await page.goto("/admin/studio-harness");
	await page
		.getByRole("button", { name: "Import chair_0", exact: true })
		.click();
	const review = page.getByRole("dialog", {
		name: "Review furniture import",
		exact: true,
	});
	await expect(
		review.getByText("Suggested: complete existing furniture", { exact: true }),
	).toBeVisible();
	await expect(
		review.getByText("Missing: Catalog offer, Furnidata, Local icon"),
	).toBeVisible();
	await review
		.getByRole("button", { name: "Conflicts (0)", exact: true })
		.click();
	await expect(
		review.getByText("No furniture in this group.", { exact: true }),
	).toBeVisible();
	await review
		.getByRole("button", { name: "To complete (1)", exact: true })
		.click();
	await expect(
		review.getByText("Suggested: complete existing furniture", { exact: true }),
	).toBeVisible();
	await review
		.getByRole("button", { name: "Continue to confirmation", exact: true })
		.click();
	await expect(
		page
			.getByRole("dialog", { name: "Confirm furniture import", exact: true })
			.getByRole("button", { name: "Start import (1)", exact: true }),
	).toBeEnabled();
});

test("an older search response cannot replace newer furniture", async ({
	page,
}) => {
	await mockStudio(page);
	await page.route("**/cms_api/admin/import/furni?*", async (route) => {
		const search = new URL(route.request().url()).searchParams.get("search");
		if (!search) return route.fallback();
		if (search === "old")
			await new Promise((resolve) => setTimeout(resolve, 1500));
		await route.fulfill({
			json: {
				items: [
					{
						...items[0],
						name: search === "old" ? "Old response" : "New response",
					},
				],
				meta: { currentPage: 1, lastPage: 1, total: 1, perPage: 100 },
			},
		});
	});
	await page.goto("/admin/studio-harness");
	const search = page.getByRole("textbox", { name: "Search furniture" });
	const oldRequest = page.waitForRequest(
		(request) => new URL(request.url()).searchParams.get("search") === "old",
	);
	await search.fill("old");
	await oldRequest;
	await search.fill("new");
	await expect(
		page.getByRole("button", { name: "View New response", exact: true }),
	).toBeVisible();
	await page.waitForTimeout(1800);
	await expect(
		page.getByRole("button", { name: "View New response", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "View Old response", exact: true }),
	).toHaveCount(0);
});
