// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
	resolve(process.cwd(), ".gitea/workflows/ci.yaml"),
	"utf8",
);

describe("CI workflow", () => {
	it("has check and deploy jobs", () => {
		expect(workflow).toContain("check:");
		expect(workflow).toContain("deploy:");
	});

	it("deploy depends on check", () => {
		expect(workflow).toContain("needs: check");
	});

	it("deploy only runs on push to main/master", () => {
		expect(workflow).toContain("gitea.event_name == 'push'");
		expect(workflow).toContain("gitea.ref_name == 'main'");
	});

	it("check runs lint, typecheck, and test", () => {
		expect(workflow).toContain("pnpm biome:lint");
		expect(workflow).toContain("pnpm typecheck");
		expect(workflow).toContain("pnpm test:coverage");
	});

	it("check job runs on host runner", () => {
		const checkJob = workflow.slice(
			workflow.indexOf("check:"),
			workflow.indexOf("\n  deploy:"),
		);
		expect(checkJob).toContain("runs-on: ubuntu-latest");
	});

	it("deploy job runs on host runner", () => {
		const deployJob = workflow.slice(workflow.indexOf("\n  deploy:"));
		expect(deployJob).toContain("runs-on: ubuntu-latest");
	});

	it("check includes toolchain check", () => {
		expect(workflow).toContain("scripts/check-node-toolchain.mjs");
	});

	it("uses only valid pnpm install flags (no --jobs)", () => {
		expect(workflow).toContain("pnpm install --frozen-lockfile");
		expect(workflow).not.toContain("--jobs");
	});

	it("does not use github context", () => {
		expect(workflow).not.toContain("github.ref");
	});

	it("has tag trigger", () => {
		expect(workflow).toContain('tags: ["v*"]');
	});

	it("smoke-tests the deployed app within the deployment transaction", () => {
		expect(workflow).toContain("bash scripts/ci-deploy.sh");
		const deploy = readFileSync("scripts/ci-deploy.sh", "utf8");
		expect(deploy).toContain(
			"node scripts/verify-deployed-release.mjs http://127.0.0.1:3002/cms_api/health",
		);
	});
});
