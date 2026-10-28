import { expect, test } from "@playwright/test";

const key = "cms:draft:v1:7:article:new";
test("browser draft survives session failure and reload, restores explicitly and clears only after save", async ({
	page,
}) => {
	await page.route("**/fixture/actions/load-recovery", (route) =>
		route.fulfill({ status: 401, body: "expired" }),
	);
	await page.route("**/fixture/actions/article", (route) =>
		route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({ ok: false, error: "Session expired" }),
		}),
	);
	await page.goto("/admin/articles/recovery");
	const title = page.locator('input[name="title"]');
	await title.fill("Keep this unfinished article");
	await expect
		.poll(() => page.evaluate((k) => localStorage.getItem(k), key))
		.toContain("Keep this unfinished article");
	await page.getByRole("button", { name: "Save article", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Session expired");
	expect(await page.evaluate((k) => localStorage.getItem(k), key)).toContain(
		"Keep this unfinished article",
	);
	page.on("dialog", (dialog) => dialog.accept());
	await page.reload();
	await expect(title).toHaveValue("Community update");
	await page
		.getByRole("button", { name: "Restore browser copy", exact: true })
		.click();
	await expect(title).toHaveValue("Keep this unfinished article");
	await page.unroute("**/fixture/actions/article");
	await page.route("**/fixture/actions/article", (route) =>
		route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({ ok: true }),
		}),
	);
	await page.getByRole("button", { name: "Save article", exact: true }).click();
	await expect
		.poll(() => page.evaluate((k) => localStorage.getItem(k), key))
		.toBeNull();
	await page.reload();
	await expect(
		page.getByRole("button", { name: "Restore browser copy", exact: true }),
	).toHaveCount(0);
});
test("pending recovery does not overwrite current edits and discard preserves them", async ({
	page,
}) => {
	await page.goto("/admin/articles/recovery");
	const title = page.locator('input[name="title"]');
	await title.fill("Older draft");
	await expect
		.poll(() => page.evaluate((k) => localStorage.getItem(k), key))
		.toContain("Older draft");
	page.on("dialog", (dialog) => dialog.accept());
	await page.reload();
	await title.fill("New current edits");
	await page
		.getByRole("button", { name: "Discard browser copy", exact: true })
		.click();
	await expect(title).toHaveValue("New current edits");
	await expect
		.poll(() => page.evaluate((k) => localStorage.getItem(k), key))
		.toContain("New current edits");
});
test("unavailable browser storage leaves the form editable", async ({
	page,
}) => {
	await page.addInitScript(() => {
		Storage.prototype.setItem = () => {
			throw Error("quota");
		};
	});
	await page.goto("/admin/articles/recovery");
	await page.locator('input[name="title"]').fill("Still editable");
	await expect(
		page.getByText("Browser recovery is unavailable.", { exact: false }),
	).toBeVisible();
	await expect(page.locator('input[name="title"]')).toHaveValue(
		"Still editable",
	);
});
test("saving while recovery is pending enables recovery for subsequent edits", async ({
	page,
}) => {
	await page.route("**/fixture/actions/article", (route) =>
		route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({ ok: true }),
		}),
	);
	await page.goto("/admin/articles/recovery");
	const title = page.locator('input[name="title"]');
	await title.fill("Previous browser draft");
	await expect
		.poll(() => page.evaluate((k) => localStorage.getItem(k), key))
		.toContain("Previous browser draft");
	page.on("dialog", (dialog) => dialog.accept());
	await page.reload();
	await expect(
		page.getByRole("button", { name: "Restore browser copy", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Save article", exact: true }).click();
	await expect
		.poll(() => page.evaluate((k) => localStorage.getItem(k), key))
		.toBeNull();
	await title.fill("Edits after successful save");
	await expect
		.poll(() => page.evaluate((k) => localStorage.getItem(k), key))
		.toContain("Edits after successful save");
});
test("unmount flush retains an edit before the autosave interval", async ({
	page,
}) => {
	// Install the fake clock before navigation so every page timer is faked,
	// then jump forward to a fixed pause point. Using wall-clock `new Date()`
	// for both calls raced under load: the fake clock ticks in real time
	// between the calls and can pass the target ("Cannot fast-forward to the
	// past"). The 60s jump only fires no-op persists on a clean form.
	await page.clock.install({ time: new Date("2030-01-01T12:00:00Z") });
	await page.goto("/admin/articles/recovery");
	await page.clock.pauseAt(new Date("2030-01-01T12:01:00Z"));
	await page.locator('input[name="title"]').fill("Immediate final edit");
	await page
		.getByRole("button", { name: "Close editor fixture", exact: true })
		.click();
	expect(await page.evaluate((k) => localStorage.getItem(k), key)).toContain(
		"Immediate final edit",
	);
});
test("event title and dates recover after reload and clear after successful update", async ({
	page,
}) => {
	const eventKey = "cms:draft:v1:7:event:12";
	await page.route("**/fixture/actions/update-event", (route) =>
		route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({ ok: true, data: { id: 12 } }),
		}),
	);
	await page.goto("/admin/events/recovery");
	const title = page.locator("#title");
	const dates = page.locator('input[type="datetime-local"]');
	await title.fill("Recovered community event");
	await dates.nth(0).fill("2030-02-03T14:30");
	await dates.nth(1).fill("2030-02-03T16:00");
	await expect
		.poll(() => page.evaluate((k) => localStorage.getItem(k), eventKey))
		.toContain("2030-02-03T14:30:00.000Z");
	page.on("dialog", (dialog) => dialog.accept());
	await page.reload();
	await expect(title).toHaveValue("Original event");
	await page
		.getByRole("button", { name: "Restore browser copy", exact: true })
		.click();
	await expect(title).toHaveValue("Recovered community event");
	await expect(dates.nth(0)).toHaveValue("2030-02-03T14:30");
	await expect(dates.nth(1)).toHaveValue("2030-02-03T16:00");
	const save = page.waitForRequest("**/fixture/actions/update-event");
	await page.locator('button[type="submit"]').click();
	expect((await save).postDataJSON()).toMatchObject({
		id: 12,
		title: "Recovered community event",
		startsAt: "2030-02-03T14:30:00.000Z",
		endsAt: "2030-02-03T16:00:00.000Z",
	});
	await expect
		.poll(() => page.evaluate((k) => localStorage.getItem(k), eventKey))
		.toBeNull();
});
