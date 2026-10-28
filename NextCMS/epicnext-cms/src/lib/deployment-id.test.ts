// @ts-nocheck
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

// The default export is a function so the build phase is known before the
// config is handed to next-intl. Any phase other than the production build
// resolves it; deploymentId itself is phase-independent.
const resolveConfig = () => nextConfig("phase-production-server");

afterEach(() => {
	delete process.env.CMS_MEMORY_CAPPED;
});

describe("deployment version skew protection", () => {
	it("uses an explicit deployment ID or the current Git commit", () => {
		const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim();

		expect(resolveConfig().deploymentId).toBe(
			process.env.NEXT_DEPLOYMENT_ID?.trim() || gitCommit,
		);
	});
});

describe("production build memory cap", () => {
	// An uncapped `next build` gets OOM-killed by the kernel on this host, and
	// the killer may take the database and the live release with it. Refusing
	// here stops the build before it allocates anything.
	it("refuses a production build that is not running under the memory cap", () => {
		expect(() => nextConfig("phase-production-build")).toThrow(
			/Refusing to run an uncapped production build/,
		);
	});

	it("allows a production build when the wrapper marked it as capped", () => {
		process.env.CMS_MEMORY_CAPPED = "1";
		expect(() => nextConfig("phase-production-build")).not.toThrow();
	});

	// Only production builds are heavy enough to kill the machine; dev and
	// start must keep working uncapped.
	it("does not restrict other phases", () => {
		expect(() => nextConfig("phase-development-server")).not.toThrow();
		expect(() => nextConfig("phase-production-server")).not.toThrow();
	});
});
