import { defineConfig, devices } from "@playwright/test";

// Deploy gate: keep this suite deterministic and light. One worker, one browser
// engine, no live dev server and no parallelism — that is what keeps the host
// from pinning at 100% CPU while the specs run.
export default defineConfig({
	testDir: "./e2e",
	testIgnore: ["**/ui/**", "**/imaging/**", "**/news-real/**", "**/quality/**"],
	forbidOnly: !!process.env.CI,
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	timeout: 30000,
	expect: { timeout: 10000 },
	globalTimeout: 10 * 60 * 1000,
	maxFailures: process.env.CI ? 10 : undefined,
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3002",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "off",
		launchOptions: {
			args: [
				"--disable-gpu",
				"--disable-software-rasterizer",
				"--disable-dev-shm-usage",
				"--disable-background-networking",
				"--disable-default-apps",
				"--disable-extensions",
				"--disable-sync",
				"--metrics-recording-only",
				"--mute-audio",
				"--no-first-run",
			],
		},
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
