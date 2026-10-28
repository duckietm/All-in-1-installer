import { expect, test } from "@playwright/test";

const attachmentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const file = {
	name: "fixture_chair.hab",
	mimeType: "application/octet-stream",
	buffer: Buffer.from("isolated upload fixture"),
};

test.beforeEach(async ({ page }) => {
	await page.goto("/admin/attachment-harness");
	await page
		.getByText("Attach original file and resume", { exact: true })
		.click();
});

test("attachment upload and double-click resume send one retry and refresh history", async ({
	page,
}) => {
	let retries = 0;
	await page.route("**/cms_api/admin/studio/import-attachment", async (route) => {
		expect(route.request().method()).toBe("POST");
		expect(route.request().postData()).toContain('name="classname"');
		expect(route.request().postData()).toContain("fixture_chair");
		expect(route.request().postData()).toContain(
			'filename="fixture_chair.hab"',
		);
		await route.fulfill({ json: { ok: true, attachmentId } });
	});
	await page.route("**/cms_api/admin/studio/import-jobs", async (route) => {
		retries++;
		expect(route.request().method()).toBe("PATCH");
		expect(route.request().postDataJSON()).toEqual({
			id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			action: "retry",
			attachments: { fixture_chair: attachmentId },
		});
		await new Promise((resolve) => setTimeout(resolve, 150));
		await route.fulfill({ json: { ok: true } });
	});
	await page.getByLabel("Choose the original .hab file").setInputFiles(file);
	await expect(
		page.getByText("Matching original file attached", { exact: true }),
	).toBeVisible();
	await page
		.getByRole("button", {
			name: "Resume failed imports with this file",
			exact: true,
		})
		.dblclick();
	await expect(page.getByLabel("Resumed count")).toHaveText("1");
	expect(retries).toBe(1);
	await expect(
		page.getByRole("button", {
			name: "Resume failed imports with this file",
			exact: true,
		}),
	).toHaveCount(0);
});

for (const scenario of [
	{
		name: "owner rejection",
		status: 403,
		code: "forbidden",
		message: "Could not attach the file.",
	},
	{
		name: "mismatched furniture",
		status: 400,
		code: "mismatchedFile",
		message: "This file belongs to different furniture.",
	},
	{
		name: "network failure",
		status: 0,
		code: "",
		message: "Network connection failed",
	},
])
	test(`attachment ${scenario.name} shows readable error without enabling resume`, async ({
		page,
	}) => {
		let retries = 0;
		await page.route("**/cms_api/admin/studio/import-jobs", async (route) => {
			retries++;
			await route.fulfill({ json: { ok: true } });
		});
		await page.route("**/cms_api/admin/studio/import-attachment", (route) =>
			scenario.status
				? route.fulfill({
						status: scenario.status,
						json: { ok: false, code: scenario.code },
					})
				: route.abort("failed"),
		);
		await page.getByLabel("Choose the original .hab file").setInputFiles(file);
		await expect(page.getByRole("alert")).toContainText(scenario.message);
		await expect(
			page.getByRole("button", {
				name: "Resume failed imports with this file",
				exact: true,
			}),
		).toHaveCount(0);
		await expect(page.getByLabel("Resumed count")).toHaveText("0");
		expect(retries).toBe(0);
	});
