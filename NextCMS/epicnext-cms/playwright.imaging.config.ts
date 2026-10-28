import { defineConfig, devices } from "@playwright/test";

// Cross-browser imaging checks. Unlike the main e2e config (chromium only,
// used as the deploy gate), this runs the same specs across every bundled
// engine so an avatar format that only one browser can decode is caught.
//
// Point it at a running CMS with PLAYWRIGHT_BASE_URL (defaults to the local
// host port). Requires all three engines: `pnpm exec playwright install
// chromium firefox webkit`.
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3002";

export default defineConfig({
	testDir: "./e2e/imaging",
	fullyParallel: false,
	workers: 1,
	retries: 1,
	timeout: 60000,
	expect: {
		timeout: 15000,
		toHaveScreenshot: {
			animations: "disabled",
			caret: "hide",
			maxDiffPixelRatio: 0.02,
		},
	},
	reporter: [
		["list"],
		["html", { outputFolder: "playwright-report/imaging", open: "never" }],
	],
	outputDir: "test-results/imaging",
	use: {
		baseURL,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{ name: "firefox", use: { ...devices["Desktop Firefox"] } },
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
	],
});
