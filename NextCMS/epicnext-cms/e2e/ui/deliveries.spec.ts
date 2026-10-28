import { expect, test } from "@playwright/test";

test("deliveries explain outcomes without exposing unauthorized content or raw metadata", async ({
	page,
}, testInfo) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/admin/deliveries-harness");
	const review = page.getByRole("region", { name: "Delivery review" });
	const cards = review.getByRole("article");
	await expect(cards).toHaveCount(6);
	const news = cards.nth(0);
	await expect(news.getByRole("heading", { level: 2 })).toContainText(
		"Community update: SummerFestival",
	);
	await expect(news.getByText("Waiting", { exact: true })).toBeVisible();
	await expect(
		news.getByText(
			"The content is saved. This update runs in the background.",
			{ exact: true },
		),
	).toBeVisible();
	await expect(news.getByRole("status")).toContainText(
		"The news cache could not be refreshed.",
	);
	await expect(news.getByRole("status")).toContainText(
		"Next automatic attempt: Jan 1, 2030, 12:05 PM",
	);
	await expect(
		news.getByRole("link", { name: "Open content", exact: true }),
	).toHaveAttribute("href", "/admin/articles/9007199254740993");
	await expect(
		news.getByRole("link", { name: "Service diagnostics", exact: true }),
	).toHaveAttribute(
		"href",
		"/admin/devops/cms-errors?q=4f3df172-f1ca-4c26-a23e-cb4e6c13e9f2",
	);
	const failed = cards.nth(1);
	await expect(
		failed.getByRole("heading", { name: "9 catalog offers", exact: true }),
	).toBeVisible();
	await expect(
		failed.getByText("Needs attention", { exact: true }),
	).toBeVisible();
	await expect(failed.getByRole("status")).toContainText(
		"Check the emulator connection.",
	);
	await expect(failed.getByRole("status")).toContainText(
		"Automatic attempts are exhausted.",
	);
	await expect(
		failed.getByRole("link", { name: "Open content", exact: true }),
	).toHaveAttribute("href", "/admin/catalog");
	await expect(
		failed.getByRole("button", { name: "Retry delivery", exact: true }),
	).toBeVisible();
	for (const card of [cards.nth(2), cards.nth(3)]) {
		await expect(
			card.getByRole("heading", {
				name: "Content details unavailable",
				exact: true,
			}),
		).toBeVisible();
		await expect(
			card.getByRole("link", { name: "Open content", exact: true }),
		).toHaveCount(0);
		await expect(
			card.getByRole("button", { name: "Retry delivery", exact: true }),
		).toHaveCount(0);
	}
	const unknown = cards.nth(4);
	await expect(
		unknown.getByText("Other background update", { exact: true }),
	).toBeVisible();
	await expect(
		unknown.getByText("Unknown status", { exact: true }),
	).toBeVisible();
	await expect(unknown).toContainText("Time unavailable");
	await expect(unknown).toContainText("System");
	await expect(cards.nth(5)).toContainText(
		"Check the Git export history for the final result; disabled export does not publish files.",
	);
	await expect(review).not.toContainText(
		/RESTRICTED_NEWS_TITLE|SERIALIZED_METADATA_SECRET|INTERNAL_FILE_PATH_SECRET|UNKNOWN_OPERATION_SECRET|489 catalog offers|resultJson|articleId/,
	);
	await expect(review.locator("details[open]")).toHaveCount(0);
	await expect(
		news.getByText("Operation: operation-authorized-news-1234567890", {
			exact: true,
		}),
	).toBeHidden();
	await expect(
		news.getByText("Delivery: delivery-authorized-news-1234567890", {
			exact: true,
		}),
	).toBeHidden();
	await news.locator("summary").click();
	await expect(
		news.getByText("Operation: operation-authorized-news-1234567890", {
			exact: true,
		}),
	).toBeVisible();
	await expect(
		news.getByText("Delivery: delivery-authorized-news-1234567890", {
			exact: true,
		}),
	).toBeVisible();
	await news.locator("summary").click();
	await expect(
		news.getByText("Operation: operation-authorized-news-1234567890", {
			exact: true,
		}),
	).toBeHidden();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	const title = news.getByRole("heading", { level: 2 });
	expect(
		await title.evaluate((node) => node.scrollWidth <= node.clientWidth),
	).toBe(true);
	await page.evaluate(() => window.scrollTo(0, 0));
	await testInfo.attach("delivery-cards", {
		body: await page.screenshot({ fullPage: true }),
		contentType: "image/png",
	});
	expect(errors).toEqual([]);
});
