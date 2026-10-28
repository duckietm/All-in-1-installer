import { defineConfig, devices } from "@playwright/test";

if (!process.env.NEWS_E2E_FIXTURE || !process.env.NEWS_E2E_BASE_URL)
	throw Error(
		"Run this suite with pnpm test:news:real; it requires disposable services.",
	);

export default defineConfig({
	testDir: ".",
	testMatch: "news.spec.ts",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 240_000,
	expect: { timeout: 15_000 },
	outputDir: "../../test-results/news-real",
	reporter: [
		["list"],
		[
			"html",
			{ outputFolder: "../../playwright-report/news-real", open: "never" },
		],
	],
	use: {
		baseURL: process.env.NEWS_E2E_BASE_URL,
		locale: "en-US",
		ignoreHTTPSErrors: true,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "off",
		launchOptions: {
			executablePath: process.env.UI_TEST_BROWSER_PATH || undefined,
		},
	},
	projects: [
		{ name: "chromium-real-news", use: { ...devices["Desktop Chrome"] } },
	],
});
