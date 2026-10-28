import { randomInt } from "node:crypto";
import { defineConfig } from "@playwright/test";

// The fixture server binds a loopback port. The CI runner packs several jobs
// onto the shared host network (capacity > 1), so a fixed port makes concurrent
// runs fight over the bind: one wins, the other's browser then gets
// "connection refused". Pick one random high port for the whole run and pass it
// to every worker through the environment, unless a port is pinned explicitly
// (e.g. a developer reusing a manually started fixture server).
function fixturePort() {
	const requested = Number(process.env.UI_TEST_PORT);
	if (Number.isInteger(requested) && requested >= 1024 && requested <= 65535)
		return requested;
	const shared = Number(process.env.PW_UI_TEST_PORT);
	if (Number.isInteger(shared) && shared >= 1024 && shared <= 65535)
		return shared;
	const port = randomInt(30000, 50000);
	process.env.PW_UI_TEST_PORT = String(port);
	return port;
}
const port = fixturePort();
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
	testDir: "./e2e/ui",
	testMatch: "**/*.spec.ts",
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	timeout: 45000,
	expect: {
		timeout: 10000,
		toHaveScreenshot: {
			animations: "disabled",
			caret: "hide",
			maxDiffPixelRatio: 0.002,
		},
	},
	snapshotPathTemplate: `{testDir}/__screenshots__/${process.platform}/{projectName}/{testFilePath}/{arg}{ext}`,
	reporter: [
		["list"],
		["html", { outputFolder: "playwright-report/ui", open: "never" }],
	],
	outputDir: "test-results/ui",
	use: {
		baseURL,
		locale: "en-US",
		timezoneId: "UTC",
		colorScheme: "dark",
		contextOptions: { reducedMotion: "reduce" },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		launchOptions: process.env.UI_TEST_BROWSER_PATH
			? { executablePath: process.env.UI_TEST_BROWSER_PATH }
			: {},
	},
	projects: [
		{
			name: "desktop-chromium",
			use: { browserName: "chromium", viewport: { width: 1280, height: 900 } },
		},
		{
			name: "mobile-chromium",
			use: {
				browserName: "chromium",
				viewport: { width: 390, height: 844 },
				isMobile: true,
				deviceScaleFactor: 1,
				hasTouch: true,
			},
		},
		{
			name: "desktop-firefox",
			use: { browserName: "firefox", viewport: { width: 1280, height: 900 } },
		},
		{
			name: "desktop-webkit",
			use: { browserName: "webkit", viewport: { width: 1280, height: 900 } },
		},
	],
	webServer: {
		command: "node e2e/ui/fixture-server.mjs",
		url: `${baseURL}/health`,
		timeout: 120000,
		reuseExistingServer: !process.env.CI,
		env: { UI_TEST_PORT: String(port) },
	},
});
