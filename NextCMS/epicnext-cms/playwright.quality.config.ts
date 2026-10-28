import { defineConfig, devices } from "@playwright/test";

// Advisory quality suite. Unlike the main e2e config (the blocking deploy
// gate), this checks things that depend on live content and data — broken
// uploads, legacy malformed avatar figures, warm-page latency. Those are real
// signals but they are not something a code change can guarantee, so they must
// never block a deploy. Point it at a running CMS with PLAYWRIGHT_BASE_URL
// (defaults to the local host port).
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3002";

export default defineConfig({
	testDir: "./e2e/quality",
	fullyParallel: false,
	workers: 1,
	retries: 1,
	timeout: 60000,
	expect: { timeout: 15000 },
	reporter: [
		["list"],
		["html", { outputFolder: "playwright-report/quality", open: "never" }],
	],
	outputDir: "test-results/quality",
	use: {
		baseURL,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
