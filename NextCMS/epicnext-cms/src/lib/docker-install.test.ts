// @ts-nocheck
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
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
				.flatMap((dir) => [
					join(dir, "bash.exe"),
					join(dirname(dir), "bin", "bash.exe"),
					join(dirname(dirname(dir)), "bin", "bash.exe"),
				])
				.find((path) => existsSync(path)) ?? "bash")
		: "bash";
function configure(
	input: string,
	existing?: string,
	profile?: string,
	start = false,
) {
	const dir = mkdtempSync(join(tmpdir(), "cms-install-test-"));
	try {
		mkdirSync(join(dir, "scripts"));
		for (const name of ["docker-install.sh", "docker-config.sh"])
			copyFileSync(resolve(root, "scripts", name), join(dir, "scripts", name));
		writeFileSync(
			join(dir, "scripts/docker-update.sh"),
			"#!/usr/bin/env bash\nprintf 'Update invoked\\n'\n",
		);
		copyFileSync(
			resolve(root, "docker-image.txt"),
			join(dir, "docker-image.txt"),
		);
		if (existing !== undefined) writeFileSync(join(dir, ".env"), existing);
		if (profile !== undefined)
			writeFileSync(join(dir, ".docker-install"), profile);
		const result = spawnSync(
			bash,
			[
				join(dir, "scripts/docker-install.sh"),
				...(start ? [] : ["--configure-only"]),
			],
			{
				cwd: dir,
				input,
				encoding: "utf8",
				timeout: 15000,
				env: {
					...process.env,
					BASH_ENV: resolve(root, "src/test/docker-install-harness.sh"),
					CMS_PUBLIC_URL: undefined,
					CMS_IMAGE_REPOSITORY: undefined,
				},
			},
		);
		if (result.error) throw result.error;
		return {
			status: result.status,
			output: result.stdout + result.stderr,
			env: existsSync(join(dir, ".env"))
				? readFileSync(join(dir, ".env"), "utf8")
				: "",
			profile: existsSync(join(dir, ".docker-install"))
				? readFileSync(join(dir, ".docker-install"), "utf8")
				: "",
			injected: existsSync(join(dir, "injected")),
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
const answers = [
	"https://hotel.example",
	"prebuilt",
	"Test Hotel",
	"",
	"",
	"hotel",
	"cms",
	"p@ss'$ word",
	"",
	"https://imager.example/imaging",
	"",
].join("\n");
describe("guided Docker installation", () => {
	it("generates a unique secret and encodes database credentials without exposing them", () => {
		const result = configure(answers);
		expect(result.status, result.output).toBe(0);
		expect(result.env).toContain(
			"mysql://cms:p%40ss%27%24%20word@127.0.0.1:3306/hotel",
		);
		const secret = result.env.match(/AUTH_SECRET='([a-f0-9]{64})'/)?.[1];
		expect(secret).toHaveLength(64);
		expect(result.output).not.toContain(secret);
		expect(result.output).not.toContain("p@ss");
		expect(result.profile).toBe(
			"MODE=prebuilt\nPUBLIC_URL=https://hotel.example\n",
		);
		expect(result.output).toContain("No container was started");
	});
	it("preserves an existing environment byte for byte", () => {
		const existing = "AUTH_SECRET=keep-me\nDATABASE_URL=existing\n";
		const result = configure("https://hotel.example\nsource\n", existing);
		expect(result.status, result.output).toBe(0);
		expect(result.env).toBe(existing);
		expect(result.profile).toContain("MODE=source");
	});
	it("does not create configuration when input is cancelled", () => {
		const result = configure("https://hotel.example\nprebuilt\n");
		expect(result.status).not.toBe(0);
		expect(result.env).toBe("");
		expect(result.profile).toBe("");
	});
	it("rejects unsafe dotenv values", () => {
		const result = configure(answers.replace("Test Hotel", "Hotel '$BAD"));
		expect(result.status).not.toBe(0);
		expect(result.env).toBe("");
	});
	it("treats saved settings as data, never shell commands", () => {
		const result = configure(
			"",
			"original",
			"MODE=$(touch injected)\nPUBLIC_URL=https://hotel.example\n",
		);
		expect(result.status).not.toBe(0);
		expect(result.env).toBe("original");
		expect(result.injected).toBe(false);
	});
});

it("hands a completed installation to the existing updater", () => {
	const result = configure(answers, undefined, undefined, true);
	expect(result.status, result.output).toBe(0);
	expect(result.output).toContain("Update invoked");
	expect(result.profile).toContain("MODE=prebuilt");
});

it("defaults a new clone to source without requiring registry access", () => {
	const result = configure(
		"https://hotel.example\n\n",
		"AUTH_SECRET=existing\n",
	);
	expect(result.status, result.output).toBe(0);
	expect(result.profile).toContain("MODE=source");
});
it("keeps a saved prebuilt choice when the operator accepts defaults", () => {
	const result = configure(
		"\n\n",
		"AUTH_SECRET=existing\n",
		"MODE=prebuilt\nPUBLIC_URL=https://hotel.example\n",
	);
	expect(result.status, result.output).toBe(0);
	expect(result.profile).toContain("MODE=prebuilt");
});

it("preflight treats dotenv as configuration data instead of executing host commands", () => {
	const dir = mkdtempSync(join(tmpdir(), "cms-preflight-test-"));
	try {
		mkdirSync(join(dir, "scripts"));
		copyFileSync(
			resolve(root, "scripts/docker-preflight.sh"),
			join(dir, "scripts/docker-preflight.sh"),
		);
		writeFileSync(join(dir, ".env"), "touch injected\n");
		const result = spawnSync(bash, [join(dir, "scripts/docker-preflight.sh")], {
			cwd: dir,
			encoding: "utf8",
			timeout: 15000,
			env: {
				...process.env,
				ENV_FILE: join(dir, ".env"),
				MYSQL_PORT: "1",
				REDIS_PORT: "1",
				CMS_PORT: "1",
				BASH_ENV: resolve(root, "src/test/docker-install-harness.sh"),
			},
		});
		if (result.error) throw result.error;
		expect(existsSync(join(dir, "injected"))).toBe(false);
		expect(result.stdout).toContain("Dotenv is not executed");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
