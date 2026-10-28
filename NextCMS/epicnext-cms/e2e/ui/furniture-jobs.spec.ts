import { expect, test } from "@playwright/test";
import {
	furnitureCursorFixture,
	furnitureJobFixture,
} from "../../src/test/furniture-jobs-fixtures";

test("history hook deduplicates refreshes, pages and reports completion once", async ({
	page,
}) => {
	let requests = 0;
	let completed = false;
	await page.route("**/cms_api/admin/studio/import-jobs?*", async (route) => {
		requests++;
		const secondPage = new URL(route.request().url()).searchParams.has(
			"before",
		);
		await new Promise((resolve) => setTimeout(resolve, 100));
		await route.fulfill({
			json: {
				ok: true,
				jobs: [
					{
						...furnitureJobFixture,
						id: secondPage
							? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
							: furnitureJobFixture.id,
						state: completed ? "completed" : "queued",
					},
				],
				nextCursor: secondPage ? null : furnitureCursorFixture,
			},
		});
	});
	await page.goto("/admin/jobs-harness");
	await expect(page.getByLabel("Jobs", { exact: true })).toContainText(
		furnitureJobFixture.id,
	);
	await expect(page.getByLabel("Loading", { exact: true })).toHaveText("false");
	const initial = requests;
	await page.getByRole("button", { name: "Refresh twice" }).click();
	await expect(page.getByLabel("Loading", { exact: true })).toHaveText("true");
	await expect(page.getByLabel("Loading", { exact: true })).toHaveText("false");
	expect(requests).toBe(initial + 1);
	await page.getByRole("button", { name: "Next page" }).click();
	await expect(page.getByLabel("Page", { exact: true })).toHaveText("2");
	await expect(page.getByLabel("Jobs", { exact: true })).toContainText(
		"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
	);
	await page.getByRole("button", { name: "Previous page" }).click();
	await expect(page.getByLabel("Page", { exact: true })).toHaveText("1");
	await expect(page.getByLabel("Jobs", { exact: true })).toContainText(
		furnitureJobFixture.id,
	);
	await expect(page.getByLabel("Loading", { exact: true })).toHaveText("false");
	completed = true;
	await page.getByRole("button", { name: "Refresh twice" }).click();
	await expect(page.getByLabel("Loading", { exact: true })).toHaveText("true");
	await expect(page.getByLabel("Completions", { exact: true })).toHaveText("1");
	await expect(page.getByLabel("Loading", { exact: true })).toHaveText("false");
	await page.getByRole("button", { name: "Refresh twice" }).click();
	await expect(page.getByLabel("Loading", { exact: true })).toHaveText("true");
	await expect(page.getByLabel("Loading", { exact: true })).toHaveText("false");
	await expect(page.getByLabel("Completions", { exact: true })).toHaveText("1");
});

test("history polling pauses while hidden and refreshes on visibility return", async ({
	page,
}) => {
	let requests = 0;
	await page.clock.install();
	await page.route("**/cms_api/admin/studio/import-jobs?*", (route) => {
		requests++;
		return route.fulfill({
			json: { ok: true, jobs: [furnitureJobFixture], nextCursor: null },
		});
	});
	await page.goto("/admin/jobs-harness");
	await expect(page.getByLabel("Jobs", { exact: true })).toContainText(
		furnitureJobFixture.id,
	);
	await expect(page.getByLabel("Loading", { exact: true })).toHaveText("false");
	await page.evaluate(() => {
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => "hidden",
		});
		document.dispatchEvent(new Event("visibilitychange"));
	});
	const hiddenCount = requests;
	await page.clock.fastForward(60000);
	expect(requests).toBe(hiddenCount);
	await page.evaluate(() => {
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => "visible",
		});
		document.dispatchEvent(new Event("visibilitychange"));
	});
	await expect.poll(() => requests).toBe(hiddenCount + 1);
});

test("history shows the current phase and validated recovery source", async ({
	page,
}) => {
	await page.route("**/cms_api/admin/studio/import-jobs?*", (route) =>
		route.fulfill({
			json: {
				ok: true,
				jobs: [
					{
						...furnitureJobFixture,
						state: "running",
						items: [
							{
								...furnitureJobFixture.items[0],
								state: "running",
								phase: "writing_db",
								phaseStartedAt: new Date().toISOString(),
								recoveredSource: {
									sourceId: "configured",
									sourceName: "Configured source",
									revision: 42,
								},
							},
						],
					},
				],
				nextCursor: null,
			},
		}),
	);
	await page.goto("/admin/jobs-harness?progress");
	await page.locator("details details summary").click();
	await expect(
		page.getByText("Current phase: Saving SQL and catalog"),
	).toBeVisible();
	await expect(
		page.getByText(/Bundle recovered from Configured source/),
	).toBeVisible();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth > innerWidth,
		),
	).toBe(false);
});

test("uncertain import submissions keep their identity after a page reload", async ({
	page,
}) => {
	const ids: string[] = [];
	await page.route("**/cms_api/admin/csrf", (route) =>
		route.fulfill({ json: { token: "a".repeat(64) } }),
	);
	await page.route("**/cms_api/admin/studio/import-jobs**", async (route) => {
		if (route.request().method() !== "POST") {
			await route.fulfill({ json: { ok: true, jobs: [], nextCursor: null } });
			return;
		}
		const body = route.request().postDataJSON();
		ids.push(body.id);
		if (ids.length === 1) await route.abort("failed");
		else
			await route.fulfill({
				json: { ok: true, job: { ...furnitureJobFixture, id: body.id } },
			});
	});
	await page.goto("/admin/jobs-harness");
	await page
		.getByRole("button", { name: "Submit import", exact: true })
		.click();
	await expect(page.getByLabel("Submitted", { exact: true })).toHaveText(
		"false",
	);
	await page.reload();
	await page
		.getByRole("button", { name: "Submit import", exact: true })
		.click();
	await expect(page.getByLabel("Submitted", { exact: true })).toHaveText(
		"true",
	);
	expect(ids).toHaveLength(2);
	expect(ids[1]).toBe(ids[0]);
	await page
		.getByRole("button", { name: "Submit import", exact: true })
		.click();
	await expect.poll(() => ids.length).toBe(3);
	expect(ids[2]).not.toBe(ids[0]);
});
