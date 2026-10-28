import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
			"server-only": fileURLToPath(
				new URL("./src/test/server-only-stub.ts", import.meta.url),
			),
		},
	},
	test: {
		setupFiles: ["./vitest.setup.ts"],
		environment: "node",
		include: ["integration/**/*.test.ts"],
		fileParallelism: false,
		maxWorkers: 1,
		hookTimeout: 180_000,
		testTimeout: 60_000,
		coverage: { enabled: false },
	},
});
