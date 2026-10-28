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
const sha = "a".repeat(40);
function simulate(scenario: string, args: string[] = []) {
	const dir = mkdtempSync(join(tmpdir(), "cms-compose-test-"));
	try {
		mkdirSync(join(dir, "scripts"));
		mkdirSync(join(dir, "logs"));
		copyFileSync(
			resolve(root, "scripts/docker-update-options.sh"),
			join(dir, "scripts/docker-update-options.sh"),
		);
		copyFileSync(
			resolve(root, "scripts/docker-config.sh"),
			join(dir, "scripts/docker-config.sh"),
		);
		copyFileSync(
			resolve(root, "docker-image.txt"),
			join(dir, "docker-image.txt"),
		);
		writeFileSync(
			join(dir, "logs/docker-release-history.log"),
			`${"b".repeat(40)}\n${"c".repeat(40)}\n`,
		);
		copyFileSync(
			resolve(root, "scripts/docker-update.sh"),
			join(dir, "scripts/docker-update.sh"),
		);
		copyFileSync(
			resolve(root, "scripts/docker-prune.sh"),
			join(dir, "scripts/docker-prune.sh"),
		);
		writeFileSync(join(dir, ".env"), "HOTEL_NAME=Test\n");
		// De CI-eigendomscontrole leest het nginx-upstream-bestand, net als
		// scripts/ci-deploy.sh. Tests draaien op de productiehost, dus het
		// scenario 'ci-upstream' levert zelf een bestand met een slot erin en alle
		// andere scenario's een leeg bestand — anders zou elke test hier op een
		// echte blue/green-host onterecht stoppen.
		writeFileSync(
			join(
				dir,
				scenario === "ci-upstream"
					? "cms_upstream_servers.conf"
					: "no-such-upstream.conf",
			),
			scenario === "ci-upstream"
				? "server 127.0.0.1:3003 max_fails=2 fail_timeout=10s;\n"
				: "",
		);
		if (scenario.startsWith("saved-"))
			writeFileSync(
				join(dir, ".docker-install"),
				`MODE=${scenario === "saved-source" ? "source" : "prebuilt"}\nPUBLIC_URL=https://saved.test\n`,
			);
		const result = spawnSync(
			bash,
			[join(dir, "scripts/docker-update.sh"), ...args],
			{
				cwd: dir,
				encoding: "utf8",
				timeout: 25000,
				env: {
					...process.env,
					BASH_ENV: resolve(root, "src/test/docker-update-harness.sh"),
					TEST_DIR: dir.replaceAll("\\", "/"),
					TEST_SHA: sha,
					SCENARIO: scenario,
					CMS_PUBLIC_URL: scenario.startsWith("saved-")
						? undefined
						: "https://example.test",
					CMS_IMAGE_REPOSITORY: scenario.startsWith("saved-")
						? undefined
						: scenario.startsWith("registry")
							? "registry.test/team/cms"
							: "",
					CMS_UPSTREAM_FILE: join(
						dir,
						scenario === "ci-upstream"
							? "cms_upstream_servers.conf"
							: "no-such-upstream.conf",
					).replaceAll("\\", "/"),
				},
			},
		);
		if (result.error) throw result.error;
		return {
			status: result.status,
			restored: existsSync(join(dir, "restored")),
			output: result.stdout + result.stderr,
			calls: existsSync(join(dir, "calls"))
				? readFileSync(join(dir, "calls"), "utf8")
				: "",
		};
	} finally {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
}
describe("Docker clone updates", () => {
	it("pulls matching prebuilt application and migrations without building", () => {
		const r = simulate("registry");
		expect(r.status, r.output).toBe(0);
		expect(r.calls).toContain(`docker pull registry.test/team/cms:${sha}`);
		expect(r.calls).toContain(
			`docker pull registry.test/team/cms:${sha}-migrations`,
		);
		expect(r.calls).not.toMatch(/docker build\s/);
		expect(r.calls).not.toContain("docker compose build");
		expect(r.calls).toContain("target=/app/.env,readonly");
	});
	it("keeps the current container when the registry pull fails", () => {
		const r = simulate("registry-failure");
		expect(r.status).not.toBe(0);
		expect(r.calls).not.toContain("compose up");
	});
	it("removes only historical release tags beyond the current and previous", () => {
		const r = simulate("success");
		expect(r.calls).toContain(`docker image rm epicnext-cms:${"c".repeat(40)}`);
		expect(r.calls).not.toContain(
			`docker image rm epicnext-cms:${"b".repeat(40)}`,
		);
	});
	it("preserves older images used by another container", () => {
		const r = simulate("retained-in-use");
		expect(r.status, r.output).toBe(0);
		expect(r.calls).not.toContain(
			`docker image rm epicnext-cms:${"c".repeat(40)}`,
		);
	});
	it("reports an unsuccessful rollback and retains the recovery image", () => {
		const r = simulate("rollback-failure");
		expect(r.status).not.toBe(0);
		expect(r.output).toContain("rollback could not recreate CMS");
		expect(r.calls).not.toContain("docker image rm epicnext-cms:rollback-");
	});
	it("handles first installation failures without claiming rollback", () => {
		const r = simulate("first-failure");
		expect(r.status).not.toBe(0);
		expect(r.restored).toBe(false);
		expect(r.output).toContain("no previous image exists");
	});
	it("builds the pulled commit, migrates before recreation and verifies local/public HTTP", () => {
		const r = simulate("success");
		expect(r.status, r.output).toBe(0);
		expect(r.calls).toContain(`--build-arg NEXT_DEPLOYMENT_ID=${sha}`);
		expect(r.calls.indexOf("db:migrate")).toBeLessThan(
			r.calls.indexOf("compose up"),
		);
		expect(r.calls).toContain(
			"up -d --no-deps --no-build --force-recreate cms",
		);
		expect(r.calls).toContain("https://example.test/cms_api/health");
		expect(r.output).toContain(`Verified release ${sha}`);
		// A successful update runs the scoped prune (build cache + unreferenced
		// images + stopped containers), never a global or volume prune.
		expect(r.calls).toContain("docker builder prune");
		expect(r.calls).toContain("docker image prune");
		expect(r.calls).toContain("docker container prune");
		expect(r.calls).not.toContain("docker volume prune");
		expect(r.calls).not.toContain("docker system prune");
	});
	it.each(["dirty", "pull-failure", "build-failure", "migration-failure"])(
		"does not replace the container after %s",
		(scenario) => {
			const r = simulate(scenario);
			expect(r.status, r.output).not.toBe(0);
			expect(r.calls).not.toContain("compose up");
		},
	);
	// Regressie: na een cutover naar het groene slot bestaat epicnext-cms-app
	// niet meer en zag deze controle alleen een vrijgekomen blauwe container. De
	// dagelijkse `docker-update.sh` startte toen een compose-replica op poort
	// 3002 en blokkeerde elke volgende release. De blauwe container alleen
	// controleren is dus geen bewijs dat de host niet door CI beheerd wordt.
	//
	// A host owned by CI is a legitimate no-op, not an error: the cron run must
	// exit 0 so it does not look like a failed deployment.
	it.each(["ci-active", "ci-green", "ci-upstream"])(
		"skips the compose deployment while CI owns the host (%s)",
		(scenario) => {
			const r = simulate(scenario);
			expect(r.status, r.output).toBe(0);
			expect(r.output).toContain("This host is managed by CI");
			expect(r.calls).not.toContain("compose up");
		},
	);
	it.each(["wrong-image", "wrong-release", "wrong-public", "recreate-failure"])(
		"never reports success for %s",
		(scenario) => {
			const r = simulate(scenario);
			expect(r.status, r.output).not.toBe(0);
			expect(r.output).not.toContain("Verified release");
			expect(r.restored).toBe(true);
			expect(r.output).toContain("Rollback verified locally");
		},
	);
});

describe("HTTP release verification", () => {
	const script = readFileSync("scripts/docker-update.sh", "utf8");
	const probe = script.match(/^probe='(.+)'$/m)?.[1];
	it.each([
		["current", { database: true, release: sha }, 200, 0],
		["old release", { database: true, release: "old" }, 200, 1],
		["unknown release", { database: true, release: "unknown" }, 200, 1],
		["database down", { database: false, release: sha }, 200, 1],
		["HTTP failure", { database: true, release: sha }, 503, 1],
	])("checks %s", (_name, body, status, expected) => {
		expect(probe).toBeTruthy();
		const code = `import {createServer} from "node:http";const server=createServer((q,r)=>{r.writeHead(${status},{"content-type":"application/json"});r.end(${JSON.stringify(JSON.stringify(body))});});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));process.argv=[process.execPath,"http://127.0.0.1:"+server.address().port,${JSON.stringify(sha)}];try{${probe}}finally{server.close();}`;
		const result = spawnSync(
			process.execPath,
			["--input-type=module", "-e", code],
			{ encoding: "utf8", timeout: 10000 },
		);
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(expected);
	});
});

it("updates using the saved profile and repository-provided image without arguments", () => {
	const r = simulate("saved-prebuilt");
	expect(r.status, r.output).toBe(0);
	expect(r.calls).toContain(
		`docker pull gitlab.epicnabbo.nl/simo/epicnext-cms:${sha}`,
	);
	expect(r.calls).toContain("https://saved.test/cms_api/health");
	expect(r.calls).not.toContain("docker compose build");
});
it("keeps source builds available for a saved source installation", () => {
	const r = simulate("saved-source");
	expect(r.status, r.output).toBe(0);
	expect(r.calls).toContain("docker compose build");
	expect(r.calls).not.toContain("docker pull");
});

it("checks candidate storage before any database migration", () => {
	const r = simulate("storage-failure");
	expect(r.status).not.toBe(0);
	expect(r.calls).toContain(
		"docker compose run --rm --no-deps --entrypoint node",
	);
	expect(r.calls).not.toContain("--entrypoint pnpm");
	expect(r.restored).toBe(false);
});
it("rejects a migration artifact from another revision before database changes", () => {
	const r = simulate("migration-revision-mismatch");
	expect(r.status).not.toBe(0);
	expect(r.calls).not.toContain("--entrypoint pnpm");
	expect(r.output).toContain("no matching release label");
});

it("uses both immutable artifacts without pulling Git when a checked-out release is requested", () => {
	const digest = `sha256:${"1".repeat(64)}`;
	const migrations = `sha256:${"2".repeat(64)}`;
	const r = simulate("registry", [
		"--skip-pull",
		"--app-digest",
		digest,
		"--migrations-digest",
		migrations,
	]);
	expect(r.status, r.output).toBe(0);
	expect(r.calls).not.toContain("git pull");
	expect(r.calls).toContain(`docker pull registry.test/team/cms@${digest}`);
	expect(r.calls).toContain(`docker pull registry.test/team/cms@${migrations}`);
});
it("rejects incomplete artifact selection before contacting Git or Docker", () => {
	const r = simulate("registry", ["--app-digest", `sha256:${"1".repeat(64)}`]);
	expect(r.status).not.toBe(0);
	expect(r.calls).toBe("");
});

it("rejects a legacy migrations image without release metadata before database changes", () => {
	const r = simulate("migration-revision-missing");
	expect(r.status).not.toBe(0);
	expect(r.calls).not.toContain("--entrypoint pnpm");
	expect(r.calls).not.toContain("compose up");
	expect(r.output).toContain("Rebuild/publish both artifacts");
});
it("requires prebuilt mode when selecting immutable artifacts", () => {
	const digest = `sha256:${"1".repeat(64)}`;
	const r = simulate("saved-source", [
		"--app-digest",
		digest,
		"--migrations-digest",
		digest,
	]);
	expect(r.status).not.toBe(0);
	expect(r.output).toContain("Digest selection requires prebuilt mode");
	expect(r.calls).not.toContain("docker pull");
	expect(r.calls).not.toContain("--entrypoint pnpm");
	expect(r.calls).not.toContain("compose up");
});
