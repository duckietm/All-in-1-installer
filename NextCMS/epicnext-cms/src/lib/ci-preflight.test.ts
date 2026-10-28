// @ts-nocheck
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const bash =
	process.platform === "win32"
		? ((process.env.PATH ?? "")
				.split(delimiter)
				.flatMap((directory) => [
					join(directory, "bash.exe"),
					join(dirname(directory), "bin", "bash.exe"),
					join(dirname(dirname(directory)), "bin", "bash.exe"),
				])
				.find(existsSync) ?? "bash")
		: "bash";
const sha = "d".repeat(40);
function simulate(scenario: string, extraEnv: Record<string, string> = {}) {
	const directory = mkdtempSync(join(tmpdir(), "cms-preflight-test-"));
	try {
		writeFileSync(
			join(directory, ".env"),
			'echo unexpected-env-read > "$TEST_DIR/env-read"\n',
		);
		const shellDirectory = directory
			.replaceAll("\\", "/")
			.replace(/^([a-zA-Z]):/, (_, drive: string) => `/${drive.toLowerCase()}`);
		const result = spawnSync(bash, [resolve(root, "scripts/ci-preflight.sh")], {
			cwd: directory,
			encoding: "utf8",
			timeout: 15_000,
			env: {
				...process.env,
				BASH_ENV: resolve(root, "src/test/ci-preflight-harness.sh"),
				TEST_DIR: directory.replaceAll("\\", "/"),
				TMPDIR: shellDirectory,
				TEST_SHA: sha,
				SCENARIO: scenario,
				CMS_DEPLOY_DIR: "/must-not-read-production",
				DATABASE_URL: "must-not-use-production",
				// Standaard uit: de tests rimen geen cache-map aan op de host.
				CMS_BUILD_CACHE_DIR: "",
				...extraEnv,
			},
		});
		if (result.error) throw result.error;
		return {
			status: result.status,
			output: result.stdout + result.stderr,
			calls: existsSync(join(directory, "calls"))
				? readFileSync(join(directory, "calls"), "utf8")
				: "",
			remaining: readdirSync(directory).filter(
				(name) => name !== "calls" && name !== ".env",
			),
		};
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function imageFrom(calls: string) {
	const image = calls.match(
		/-t (epicnext-cms:preflight-[a-f0-9]{40}-[a-zA-Z0-9]{10}) /,
	)?.[1];
	expect(image).toBeDefined();
	return image;
}

describe("isolated branch preflight", () => {
	it("builds the production Dockerfile before testing that exact image and release", () => {
		const result = simulate("success");
		expect(result.status, result.output).toBe(0);
		const image = imageFrom(result.calls);
		expect(result.calls).toContain(`--build-arg NEXT_DEPLOYMENT_ID=${sha}`);
		expect(result.calls).toContain("pnpm install --frozen-lockfile");
		expect(result.calls).toContain("pnpm exec playwright install chromium");
		expect(result.calls).toContain(
			`news-image=${image} news-release=${sha} node --import tsx e2e/news-real/run.ts`,
		);
		expect(result.calls.indexOf("docker build")).toBeLessThan(
			result.calls.indexOf("e2e/news-real/run.ts"),
		);
		expect(result.calls.indexOf("e2e/news-real/run.ts")).toBeLessThan(
			result.calls.indexOf("docker image rm"),
		);
		expect(
			result.calls.split("\n").filter((line) => line.startsWith("docker ")),
		).toEqual([
			expect.stringContaining("docker build --progress=plain"),
			`docker image rm ${image}`,
		]);
		expect(result.calls).not.toMatch(
			/UNEXPECTED|db:migrate|deploy|registry|prune|must-not/,
		);
		expect(result.remaining).toEqual([]);
	});

	it("hergebruikt een duurzame buildcache buiten de tijdelijke werkmap", () => {
		const cacheDirectory = mkdtempSync(join(tmpdir(), "cms-preflight-cache-"));
		try {
			const cache = join(cacheDirectory, "cache");
			const result = simulate("success", { CMS_BUILD_CACHE_DIR: cache });
			expect(result.status, result.output).toBe(0);
			expect(result.calls).toContain(`--cache-from type=local,src=${cache}`);
			expect(result.calls).toContain(
				`--cache-to type=local,dest=${cache},mode=max`,
			);
			// De cache mag nooit in de tijdelijke werkmap van de preflight
			// belanden: die wordt na de run geleegd.
			expect(result.remaining).toEqual([]);
		} finally {
			rmSync(cacheDirectory, { recursive: true, force: true });
		}
	});

	it("stops after a failed build and cleans only its own attempted image", () => {
		const result = simulate("build-failure");
		expect(result.status).not.toBe(0);
		expect(result.calls).not.toContain("e2e/news-real/run.ts");
		expect(result.calls).toContain(
			`docker image rm ${imageFrom(result.calls)}`,
		);
		expect(result.remaining).toEqual([]);
	});

	it.each(["news-failure", "cleanup-failure"])(
		"fails and removes its private temporary directory after %s",
		(scenario) => {
			const result = simulate(scenario);
			expect(result.status).not.toBe(0);
			expect(result.calls).toContain("e2e/news-real/run.ts");
			expect(result.calls).toContain(
				`docker image rm ${imageFrom(result.calls)}`,
			);
			expect(result.calls).not.toMatch(
				/prune|epicnext-cms:latest|epicnext-cms:previous/,
			);
			expect(result.remaining).toEqual([]);
		},
	);

	it.each(["install-failure", "invalid-sha"])(
		"does not build or remove images after %s",
		(scenario) => {
			const result = simulate(scenario);
			expect(result.status).not.toBe(0);
			expect(result.calls).toContain("git rev-parse HEAD");
			if (scenario === "install-failure")
				expect(result.calls).toContain("pnpm install --frozen-lockfile");
			expect(result.calls).not.toContain("docker ");
			expect(result.remaining).toEqual([]);
		},
	);

	it("uses a distinct owned tag for separate runs of the same commit", () => {
		const first = simulate("success");
		const second = simulate("success");
		expect(first.status, first.output).toBe(0);
		expect(second.status, second.output).toBe(0);
		expect(imageFrom(first.calls)).not.toBe(imageFrom(second.calls));
	});
});
