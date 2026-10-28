import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/admin/unsaved-harness");
});
test("cancelled programmatic navigation preserves changes and save clears protection", async ({
	page,
}) => {
	await page.getByLabel("Working value").fill("Keep this");
	page.once("dialog", (dialog) => dialog.dismiss());
	await page.getByRole("button", { name: "Programmatic navigation" }).click();
	await expect(page.getByText("Navigation allowed")).toHaveCount(0);
	await expect(page.getByLabel("Working value")).toHaveValue("Keep this");
	await page.getByRole("button", { name: "Save working value" }).click();
	let prompts = 0;
	page.on("dialog", async (dialog) => {
		prompts++;
		await dialog.dismiss();
	});
	await page.getByRole("button", { name: "Programmatic navigation" }).click();
	await expect(page.getByText("Navigation allowed")).toBeVisible();
	expect(prompts).toBe(0);
});
test("cancelled link navigation and same-page anchors preserve the editor", async ({
	page,
}) => {
	await page.getByLabel("Working value").fill("Keep this");
	let prompts = 0;
	page.on("dialog", async (dialog) => {
		prompts++;
		await dialog.dismiss();
	});
	await page.getByRole("link", { name: "Leave editor" }).click();
	await expect(page).toHaveURL(/unsaved-harness$/);
	await page.getByRole("link", { name: "Same page" }).click();
	await expect(page).toHaveURL(/#same-page$/);
	expect(prompts).toBe(1);
});
test("prefix cancel and Escape preserve edits; accepting discard resets reopening", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Open prefix" }).click();
	await page
		.getByRole("textbox", { name: "Prefix text", exact: true })
		.fill("VIP");
	page.once("dialog", (dialog) => dialog.dismiss());
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(
		page.getByRole("textbox", { name: "Prefix text", exact: true }),
	).toHaveValue("VIP");
	page.once("dialog", (dialog) => dialog.dismiss());
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toBeVisible();
	page.once("dialog", (dialog) => dialog.accept());
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await page.getByRole("button", { name: "Open prefix" }).click();
	await expect(
		page.getByRole("textbox", { name: "Prefix text", exact: true }),
	).toHaveValue("");
});
test("successful prefix save closes without a discard prompt", async ({
	page,
}) => {
	await page.getByRole("button", { name: "Open prefix" }).click();
	await page
		.getByRole("textbox", { name: "Username", exact: true })
		.fill("Alice");
	await page
		.getByRole("textbox", { name: "Prefix text", exact: true })
		.fill("VIP");
	let prompts = 0;
	page.on("dialog", async (dialog) => {
		prompts++;
		await dialog.dismiss();
	});
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	expect(prompts).toBe(0);
});
test("supported browser back can be cancelled without changing the address or draft", async ({
	page,
}) => {
	test.skip(
		!(await page.evaluate(() => "navigation" in window)),
		"Navigation API unavailable",
	);
	await page.evaluate(() =>
		history.pushState({}, "", "/admin/unsaved-harness?step=2"),
	);
	await page.getByLabel("Working value").fill("Keep this");
	const prompt = page.waitForEvent("dialog");
	await page.evaluate(() => history.back());
	await (await prompt).dismiss();
	await expect(page).toHaveURL(/step=2$/);
	await expect(page.getByLabel("Working value")).toHaveValue("Keep this");
});

test("failed prefix save keeps the editor and dirty protection", async ({
	page,
}) => {
	await page.getByLabel("Fail prefix save").check();
	await page.getByRole("button", { name: "Open prefix" }).click();
	await page
		.getByRole("textbox", { name: "Username", exact: true })
		.fill("Alice");
	await page
		.getByRole("textbox", { name: "Prefix text", exact: true })
		.fill("VIP");
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	page.once("dialog", (dialog) => dialog.dismiss());
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(
		page.getByRole("textbox", { name: "Prefix text", exact: true }),
	).toHaveValue("VIP");
});
