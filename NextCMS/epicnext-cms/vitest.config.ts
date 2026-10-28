import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Project-local config: keeps the `@/` alias, the server-only stub and the
// env fallbacks with the repo instead of relying on whatever vite config a
// parent directory happens to provide.
export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
			// server-only throws in Node; tests don't need the Next client guard.
			"server-only": fileURLToPath(
				new URL("./src/test/server-only-stub.ts", import.meta.url),
			),
		},
	},
	test: {
		setupFiles: ["./vitest.setup.ts"],
		environment: "node",
		// Preserve module-initialization calls used by route permission contract tests.
		clearMocks: false,
		// Modules under test transitively import @/env; skip its strict parse so
		// unit tests run without a populated .env.
		env: {
			SKIP_ENV_VALIDATION: "1",
			HOTEL_NAME: "TestHotel",
			DATABASE_URL: "mysql://root:root@localhost:3306/test",
		},
		testTimeout: 10000,
		maxWorkers: 1,
		fileParallelism: false,
		exclude: ["integration/**", "e2e/**", "node_modules/**", ".next/**"],
		coverage: {
			// Off unless asked for (`pnpm test:coverage` passes
			// `--coverage.enabled=true`): a focused `vitest run <file>` should
			// not fail the global thresholds it cannot possibly meet, and
			// measuring v8 coverage on every run costs real time.
			enabled: false,
			provider: "v8",
			reporter: ["text", "lcov", "html"],
			// Ratchet floor: measured 37.14 / 30.09 / 31.74 / 38.13 on the full
			// suite (statements/branches/functions/lines). Rounded down so only
			// a real regression fails the build — raise these to the new
			// measured floor whenever coverage improves.
			thresholds: {
				statements: 37,
				branches: 30,
				functions: 31,
				lines: 38,
			},
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"src/generated/**",
				"src/**/*.test.ts",
				"src/**/*.test.tsx",
				"src/**/*-client.tsx",
				"src/**/*-widget.tsx",
				"src/types/**",
				"src/test/**",
			],
		},
	},
});
