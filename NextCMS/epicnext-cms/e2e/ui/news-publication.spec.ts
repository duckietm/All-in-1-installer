import { expect, test } from "@playwright/test";

test("news editor retries a lost response with the same request across reload and clears it after success", async ({
	page,
}) => {
	const requests: Array<Record<string, string>> = [];
	let succeed = false;
	await page.route("**/fixture/actions/article", async (route) => {
		requests.push(route.request().postDataJSON());
		if (!succeed) await route.abort("failed");
		else
			await route.fulfill({
				contentType: "application/json",
				body: JSON.stringify({ ok: true, data: {} }),
			});
	});
	await page.goto("/admin/articles/new");
	await expect(page.locator("iframe.tox-edit-area__iframe")).toBeVisible();
	const save = page.getByRole("button", { name: "Save article", exact: true });
	await save.click();
	await expect(page.getByRole("alert")).toBeVisible();
	await save.click();
	await expect.poll(() => requests.length).toBe(2);
	expect(requests[1].requestKey).toBe(requests[0].requestKey);
	await page.reload();
	await expect(page.locator("iframe.tox-edit-area__iframe")).toBeVisible();
	await save.click();
	await expect.poll(() => requests.length).toBe(3);
	expect(requests[2].requestKey).toBe(requests[0].requestKey);
	const stored = await page.evaluate(() =>
		sessionStorage.getItem("cms:news:request:current:new"),
	);
	expect(stored).not.toContain("Community update");
	succeed = true;
	await save.click();
	await expect
		.poll(() =>
			page.evaluate(() =>
				sessionStorage.getItem("cms:news:request:current:new"),
			),
		)
		.toBeNull();
	expect(requests[3].requestKey).toBe(requests[0].requestKey);
	await page.locator('input[name="title"]').fill("Another article");
	await save.click();
	await expect.poll(() => requests.length).toBe(5);
	expect(requests[4].requestKey).not.toBe(requests[0].requestKey);
});
