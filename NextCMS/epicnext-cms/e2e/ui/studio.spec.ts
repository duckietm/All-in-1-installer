import { expect, test } from "@playwright/test";

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

test("Studio opens and dismisses detail, Nitro editor and import review", async ({
	page,
}) => {
	const errors: string[] = [];
	const mutations: string[] = [];
	let metadataRequests = 0;
	let qualityRequests = 0;
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/api/**", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (url.pathname === "/api/admin/studio/nitro-quality") {
			qualityRequests++;
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
		}
		if (url.pathname === "/api/admin/studio/inspect") {
			const { classnames } = request.postDataJSON() as { classnames: string[] };
			return route.fulfill({
				json: {
					items: classnames.map((classname) => ({
						classname,
						sql: [],
						catalog: [],
						furnidata: [],
						furnidataReadable: true,
						nitro: { exists: false, bytes: 0 },
						icon: { exists: false, bytes: 0 },
					})),
				},
			});
		}
		if (url.pathname === "/api/admin/studio/source-assets") {
			const body = request.postDataJSON() as {
				items: Array<{ classname: string }>;
			};
			return route.fulfill({
				json: {
					items: body.items.map(({ classname }) => ({
						classname,
						state: "available",
						revision: 1,
						alternatives: [],
						attempts: [],
					})),
				},
			});
		}
		if (request.method() !== "GET") {
			mutations.push(`${request.method()} ${url.pathname}`);
			return route.fulfill({
				status: 405,
				json: { error: "Fixture forbids mutations" },
			});
		}
		if (url.pathname.endsWith("/nitro-editor")) {
			metadataRequests++;
			return route.fulfill({
				json: {
					metadata: {
						name: "fixture_chair",
						logicType: "furniture_basic",
						visualizationType: "furniture_static",
					},
					flags: { canstandon: false, cansiton: false, canlayon: false },
				},
			});
		}
		if (url.pathname === "/api/admin/import/furni") {
			return route.fulfill({
				json:
					url.searchParams.get("action") === "stats"
						? { totalInDb: 1, inCatalog: 1, notInCatalog: 0, missingNitro: 0 }
						: {
								items,
								meta: { currentPage: 1, lastPage: 1, total: 2, perPage: 20 },
							},
			});
		}
		if (url.pathname === "/api/admin/import/clone")
			return route.fulfill({ json: { sources: [] } });
		if (url.pathname === "/api/admin/studio/import-jobs")
			return route.fulfill({ json: { ok: true, jobs: [], nextCursor: null } });
		return route.fulfill({
			status: 404,
			json: { error: "Unknown fixture endpoint" },
		});
	});
	await page.goto("/admin/studio-harness");
	await expect(
		page.getByRole("button", { name: "View Fixture chair", exact: true }),
	).toBeVisible();
	const history = page.getByRole("button", {
		name: "Refresh history",
		includeHidden: true,
	});
	await expect(history).toHaveCount(0);
	await page.locator("summary").filter({ hasText: "Import history" }).click();
	await expect(history).toBeVisible();
	await page.locator("summary").filter({ hasText: "Import history" }).click();
	await expect(history).toBeHidden();
	await page.locator("summary").filter({ hasText: "Import history" }).click();
	await expect(history).toBeVisible();
	expect(metadataRequests).toBe(0);
	await page
		.getByRole("button", { name: "View Fixture chair", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Close furniture details", exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("Synthetic chair", { exact: true }).first(),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Close furniture details", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Close furniture details", exact: true }),
	).toHaveCount(0);
	await page
		.getByRole("button", { name: "Edit nitro fixture_chair", exact: true })
		.click();
	const editor = page.getByRole("dialog", { name: "Edit Nitro", exact: true });
	await expect(editor).toBeVisible();
	await expect(
		editor.getByRole("switch", { name: "Can Sit On", exact: true }),
	).toBeVisible();
	expect(metadataRequests).toBe(1);
	expect(qualityRequests).toBe(0);
	await editor.getByRole("tab", { name: "32 / 64", exact: true }).click();
	await expect(
		editor.getByRole("button", { name: "Preview generation", exact: true }),
	).toBeVisible();
	await expect(
		editor.getByText("Scale 32 · Not included", { exact: true }),
	).toBeVisible();
	expect(qualityRequests).toBe(1);
	await editor.getByRole("tab", { name: "Visual", exact: true }).click();
	await expect(
		editor.getByRole("switch", { name: "Can Sit On", exact: true }),
	).toBeVisible();

	await editor.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(editor).toHaveCount(0);
	await page
		.getByRole("button", { name: "Import fixture_table", exact: true })
		.click();
	const review = page.getByRole("dialog", {
		name: "Review furniture import",
		exact: true,
	});
	await expect(review).toBeVisible();
	await expect(
		review.getByText("Fixture table", { exact: true }),
	).toBeVisible();
	await expect(
		review.getByRole("button", {
			name: "Continue to confirmation",
			exact: true,
		}),
	).toBeEnabled();
	await review.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(review).toHaveCount(0);
	expect(mutations).toEqual([]);
	expect(errors).toEqual([]);
});

test("Studio loads organize imports on demand and preserves the dialog on reopen", async ({
	page,
}, testInfo) => {
	const errors: string[] = [];
	const mutations: string[] = [];
	let organizeRequests = 0;
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/fixture/actions/**", async (route) => {
		mutations.push(route.request().url());
		await route.fulfill({
			status: 405,
			json: { error: "No mutations expected" },
		});
	});
	await page.route("**/api/**", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (request.method() !== "GET") {
			mutations.push(`${request.method()} ${url.pathname}`);
			return route.fulfill({
				status: 405,
				json: { error: "No mutations expected" },
			});
		}
		if (url.pathname === "/api/admin/import/organize") {
			organizeRequests++;
			return route.fulfill({
				json: {
					groups: [
						{
							name: "Fixture imports",
							icon: 1,
							layout: "default_3x3",
							total: 1,
							moved: 0,
							added: 1,
							thumbs: [],
							items: [
								{
									itemId: 1,
									catalogItemId: null,
									alreadyPlaced: false,
									itemName: "fixture_table",
									publicName: "Fixture Table",
									spriteId: 0,
									type: "s",
									interactionType: "default",
									sourcePageCaption: null,
								},
							],
						},
					],
					importRootPageId: null,
					importRootCaption: null,
				},
			});
		}
		if (url.pathname === "/api/admin/catalog/tree")
			return route.fulfill({ json: { pages: [] } });
		if (url.pathname === "/api/admin/import/furni")
			return route.fulfill({
				json:
					url.searchParams.get("action") === "stats"
						? { totalInDb: 0, inCatalog: 0, notInCatalog: 0, missingNitro: 0 }
						: {
								items: [],
								meta: { currentPage: 1, lastPage: 1, total: 0, perPage: 20 },
							},
			});
		if (url.pathname === "/api/admin/import/clone")
			return route.fulfill({ json: { sources: [] } });
		if (url.pathname === "/api/admin/studio/import-jobs")
			return route.fulfill({ json: { ok: true, jobs: [], nextCursor: null } });
		return route.fulfill({
			status: 404,
			json: { error: "Unknown fixture endpoint" },
		});
	});
	await page.goto("/admin/studio-harness");
	const trigger = page.getByRole("button", {
		name: "Organize imports",
		exact: true,
	});
	await expect(trigger).toBeVisible();
	expect(organizeRequests).toBe(0);
	await trigger.click();
	const dialog = page.getByRole("dialog", { name: /^Organize imports/ });
	await expect(dialog).toBeVisible();
	const filter = dialog.getByPlaceholder("Filter import groups...");
	await expect(filter).toBeVisible();
	await expect(dialog.locator('input[value="Fixture imports"]')).toBeVisible();
	await filter.fill("Fixture");
	expect(organizeRequests).toBe(1);
	await testInfo.attach("organize-imports", {
		body: await page.screenshot(),
		contentType: "image/png",
	});
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(trigger).toBeFocused();
	await trigger.click();
	await expect(dialog).toBeVisible();
	await expect(filter).toHaveValue("Fixture");
	await expect.poll(() => organizeRequests).toBe(2);
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
	await expect(trigger).toBeFocused();
	expect(mutations).toEqual([]);
	expect(errors).toEqual([]);
});
