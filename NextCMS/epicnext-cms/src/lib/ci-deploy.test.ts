// @ts-nocheck
import { spawnSync } from "node:child_process";
import {
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
function simulate(
	scenario: string,
	previous = "epicnext-cms-app",
	both = false,
	extraEnv: Record<string, string> = {},
) {
	const dir = mkdtempSync(join(tmpdir(), "cms-deploy-test-"));
	try {
		mkdirSync(join(dir, "production"));
		// Een werkende deploymap heeft een DATABASE_URL; die gebruikt
		// scripts/ci-deploy.sh voor de migraties op de host.
		writeFileSync(
			join(dir, "production", ".env"),
			'HOTEL_NAME="Test Hotel"\nDATABASE_URL="mysql://test:test@127.0.0.1:3306/test"\n',
		);
		if (previous) writeFileSync(join(dir, previous), "old\n");
		if (both) writeFileSync(join(dir, "epicnext-cms-app"), "old\n");
		const result = spawnSync(bash, [resolve(root, "scripts/ci-deploy.sh")], {
			cwd: dir,
			encoding: "utf8",
			timeout: 25000,
			env: {
				...process.env,
				BASH_ENV: resolve(root, "src/test/ci-deploy-harness.sh"),
				TEST_DIR: dir.replaceAll("\\", "/"),
				CMS_DEPLOY_DIR: join(dir, "production").replaceAll("\\", "/"),
				// Deze scenario's testen het in-place pad. Door een pad op te geven
				// dat niet bestaat ziet het script geen blue/green-upstream, ook niet
				// wanneer de test op de productiehost zelf draait.
				CMS_UPSTREAM_FILE: join(dir, "no-such-upstream.conf"),
				CMS_NGINX_SITE: join(dir, "no-such-nginx-site.conf"),
				TEST_SHA: sha,
				SCENARIO: scenario,
				DEPLOY_BRANCH: "main",
				// Standaard uit: de tests rimen geen cache-map aan op de host.
				CMS_BUILD_CACHE_DIR: "",
				...extraEnv,
			},
		});
		if (result.error) throw result.error;
		return {
			status: result.status,
			output: result.stdout + result.stderr,
			calls: existsSync(join(dir, "calls"))
				? readFileSync(join(dir, "calls"), "utf8")
				: "",
			app: existsSync(join(dir, "epicnext-cms-app"))
				? readFileSync(join(dir, "epicnext-cms-app"), "utf8").trim()
				: null,
			previousRestored: previous ? existsSync(join(dir, previous)) : false,
			backup: existsSync(join(dir, "epicnext-cms-rollback")),
			secondaryBackup: existsSync(join(dir, "epicnext-cms-rollback-secondary")),
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("deployment transaction", () => {
	it("publishes the commit image only after migrations, health and smoke tests", () => {
		const result = simulate("success");
		expect(result.status, result.output).toBe(0);
		expect(result.app).toBe("new");
		expect(result.calls).toContain("node --import tsx e2e/news-real/run.ts");
		expect(result.calls.indexOf("e2e/news-real/run.ts")).toBeLessThan(
			result.calls.indexOf("pnpm db:migrate"),
		);
		expect(result.backup).toBe(false);
		expect(result.calls.indexOf("pnpm db:migrate")).toBeLessThan(
			result.calls.indexOf("docker stop"),
		);
		expect(result.calls.indexOf("verify-deployed-release.mjs")).toBeLessThan(
			result.calls.indexOf("docker tag sha256:new epicnext-cms:latest"),
		);
		expect(result.calls.indexOf("pnpm test:e2e")).toBeLessThan(
			result.calls.indexOf(
				`docker tag sha256:new epicnext-cms:verified-${sha}`,
			),
		);
		expect(result.calls).toContain(
			`docker image rm epicnext-cms:verified-${"c".repeat(40)}`,
		);
		expect(result.calls).not.toContain(
			`docker image rm epicnext-cms:verified-${"b".repeat(40)}`,
		);
		expect(result.calls).not.toContain(
			`docker image rm epicnext-cms:verified-${sha}`,
		);
		expect(result.calls).toContain(
			"docker tag sha256:old epicnext-cms:previous",
		);
	});
	it.each([
		"run-failure",
		"health-failure",
		"smoke-failure",
		"release-failure",
	])(
		"restores the exact previous container after %s",
		(scenario) => {
			const result = simulate(scenario);
			expect(result.status).not.toBe(0);
			expect(result.app).toBe("old");
			expect(result.calls).not.toContain(
				`docker tag sha256:new epicnext-cms:verified-${sha}`,
			);
			expect(result.output).toContain("Rollback verified: sha256:old");
			expect(result.calls).not.toContain(
				"docker tag sha256:new epicnext-cms:latest",
			);
		},
		30000,
	);
	it("restores the legacy compose container on failure", () => {
		const result = simulate("smoke-failure", "epicnext-cms");
		expect(result.status).not.toBe(0);
		expect(result.app).toBeNull();
		expect(result.previousRestored).toBe(true);
		expect(result.calls).toContain("docker start epicnext-cms");
	});
	it.each([
		"lock-failure",
		"remote-failure",
		"build-failure",
		"migration-failure",
		"news-e2e-failure",
	])("leaves the active container untouched after %s", (scenario) => {
		const result = simulate(scenario);
		expect(result.status).not.toBe(0);
		expect(result.app).toBe("old");
		expect(result.calls).not.toContain("docker stop");
	});
	it.each(["stale", "superseded"])(
		"skips a %s commit without touching production",
		(scenario) => {
			const result = simulate(scenario);
			expect(result.status, result.output).toBe(0);
			expect(result.app).toBe("old");
			expect(result.calls).not.toContain("pnpm db:migrate");
			expect(result.calls).not.toContain("docker stop");
		},
	);
	it("reports a failed first deployment without inventing a rollback", () => {
		const result = simulate("smoke-failure", "");
		expect(result.status).not.toBe(0);
		expect(result.output).toContain("No previous container exists");
		expect(result.app).toBeNull();
	});
	// The image is tagged with the commit SHA, so a dirty tree would ship
	// uncommitted code under a label that claims otherwise. The guard has to
	// stop the release before anything is built or migrated.
	it("refuses to release from a dirty working tree", () => {
		const result = simulate("dirty-tree");
		expect(result.status, result.output).not.toBe(0);
		expect(result.output).toContain("de werkboom is niet schoon");
		expect(result.calls).not.toContain("docker build");
		expect(result.calls).not.toContain("pnpm db:migrate");
		expect(result.calls).not.toContain("docker run");
	});
	// `docker builder prune` (na elke release) gooit de buildcache weg. Zonder
	// duurzame export downloadt de volgende build alle packages opnieuw.
	it("bouwt met een duurzame buildcache buiten de werkboom", () => {
		const cacheDirectory = mkdtempSync(join(tmpdir(), "cms-deploy-cache-"));
		try {
			const cache = join(cacheDirectory, "cache");
			const result = simulate("success", "epicnext-cms-app", false, {
				CMS_BUILD_CACHE_DIR: cache,
			});
			expect(result.status, result.output).toBe(0);
			expect(result.calls).toContain(`--cache-from type=local,src=${cache}`);
			expect(result.calls).toContain(
				`--cache-to type=local,dest=${cache},mode=max`,
			);
		} finally {
			rmSync(cacheDirectory, { recursive: true, force: true });
		}
	});
});

describe("legacy and CI container coexistence", () => {
	it("stops and preserves both before starting the candidate, then removes backups only after verification", () => {
		const r = simulate("success", "epicnext-cms", true);
		expect(r.status, r.output).toBe(0);
		expect(r.calls).toContain("docker stop epicnext-cms-app");
		expect(r.calls).toContain("docker stop epicnext-cms\n");
		expect(r.calls.indexOf("docker stop epicnext-cms\n")).toBeLessThan(
			r.calls.indexOf("docker run"),
		);
		expect(r.calls.indexOf("docker stop epicnext-cms-app")).toBeLessThan(
			r.calls.indexOf("docker run"),
		);
		expect(r.backup).toBe(false);
		expect(r.secondaryBackup).toBe(false);
		expect(r.app).toBe("new");
	});
	it("restores both original containers when candidate release validation fails", () => {
		const r = simulate("release-failure", "epicnext-cms", true);
		expect(r.status, r.output).not.toBe(0);
		expect(r.previousRestored).toBe(true);
		expect(r.app).toBe("old");
		expect(r.secondaryBackup).toBe(false);
		expect(r.calls).toContain("docker start epicnext-cms");
	});
});

// Blue/green: nginx wijst pas naar de nieuwe release nadat die gezond is én de
// e2e-test heeft gewonnen. De hele winst zit in de volgorde, dus daar asserten
// we dan ook op.
function simulateBlueGreen(scenario: string, livePort = 3002) {
	const dir = mkdtempSync(join(tmpdir(), "cms-deploy-bg-"));
	try {
		mkdirSync(join(dir, "production"));
		// Een werkende deploymap heeft een DATABASE_URL; die gebruikt
		// scripts/ci-deploy.sh voor de migraties op de host.
		writeFileSync(
			join(dir, "production", ".env"),
			'HOTEL_NAME="Test Hotel"\nDATABASE_URL="mysql://test:test@127.0.0.1:3306/test"\n',
		);
		// De live release draait op `livePort`; nginx wijst ernaar.
		writeFileSync(
			join(dir, "upstream.conf"),
			`server 127.0.0.1:${livePort} max_fails=2 fail_timeout=10s;\n`,
		);
		writeFileSync(join(dir, "nginx-site.conf"), "upstream cms_app { }\n");
		// Het live container-bestand, zodat `docker inspect` hem als draaiend ziet.
		writeFileSync(join(dir, "epicnext-cms-app"), "old\n");
		// Een compose-replica uit deze checkout (scenario 'port-taken-compose' of
		// 'compose-live'); retire_compose_replicas() in het script zoekt hem op bij
		// zijn container-id en beslist aan zijn PORT of hij live draait.
		if (scenario === "port-taken-compose" || scenario === "compose-live")
			writeFileSync(join(dir, "epicnext-cms"), "compose\n");
		const result = spawnSync(bash, [resolve(root, "scripts/ci-deploy.sh")], {
			cwd: dir,
			encoding: "utf8",
			timeout: 25000,
			env: {
				...process.env,
				BASH_ENV: resolve(root, "src/test/ci-deploy-harness.sh"),
				TEST_DIR: dir.replaceAll("\\", "/"),
				CMS_DEPLOY_DIR: join(dir, "production").replaceAll("\\", "/"),
				CMS_UPSTREAM_FILE: join(dir, "upstream.conf"),
				CMS_NGINX_SITE: join(dir, "nginx-site.conf"),
				TEST_SHA: sha,
				SCENARIO: scenario,
				DEPLOY_BRANCH: "main",
				// Standaard uit: de tests rimen geen cache-map aan op de host.
				CMS_BUILD_CACHE_DIR: "",
			},
		});
		if (result.error) throw result.error;
		return {
			status: result.status,
			output: result.stdout + result.stderr,
			calls: existsSync(join(dir, "calls"))
				? readFileSync(join(dir, "calls"), "utf8")
				: "",
			upstream: existsSync(join(dir, "upstream.conf"))
				? readFileSync(join(dir, "upstream.conf"), "utf8")
				: "",
			green: existsSync(join(dir, "epicnext-cms-green"))
				? readFileSync(join(dir, "epicnext-cms-green"), "utf8").trim()
				: null,
			app: existsSync(join(dir, "epicnext-cms-app"))
				? readFileSync(join(dir, "epicnext-cms-app"), "utf8").trim()
				: null,
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("blue/green cutover", () => {
	it("starts the candidate on the idle port and keeps the live one serving", () => {
		const r = simulateBlueGreen("success");
		expect(r.status, r.output).toBe(0);
		// De kandidaat draait naast de live release, niet ervoor.
		expect(r.calls).toContain("docker run -d --name epicnext-cms-green");
		expect(r.calls).toContain("PORT=3003");
		expect(r.calls.indexOf("docker run")).toBeLessThan(
			r.calls.indexOf("docker stop epicnext-cms-app"),
		);
		// De release-hash en de e2e-test draaien tegen de kandidaat, vóór de swap.
		expect(r.calls).toContain("http://127.0.0.1:3003/api/health");
		expect(r.calls).toContain("PLAYWRIGHT_BASE_URL=http://127.0.0.1:3003");
		expect(r.calls.indexOf("pnpm test:e2e")).toBeLessThan(
			r.calls.indexOf("nginx -s reload"),
		);
	});

	it("switches nginx over before retiring the live container", () => {
		const r = simulateBlueGreen("success");
		expect(r.status, r.output).toBe(0);
		// nginx test vóór de reload, en de swap gaat vóór het stoppen: anders
		// zou er een moment zijn waarop niets draait.
		expect(r.calls).toContain("nginx -t");
		expect(r.calls.indexOf("nginx -t")).toBeLessThan(
			r.calls.indexOf("nginx -s reload"),
		);
		expect(r.calls.indexOf("nginx -s reload")).toBeLessThan(
			r.calls.indexOf("docker stop epicnext-cms-app"),
		);
		expect(r.upstream).toContain("127.0.0.1:3003");
		expect(r.upstream).not.toContain("127.0.0.1:3002");
	});

	it("alternates slots on the next release", () => {
		const r = simulateBlueGreen("success", 3003);
		expect(r.status, r.output).toBe(0);
		// Live op 3003 → de kandidaat gaat naar 3002.
		expect(r.calls).toContain("docker run -d --name epicnext-cms-app");
		expect(r.upstream).toContain("127.0.0.1:3002");
		expect(r.upstream).not.toContain("127.0.0.1:3003");
	});

	// Regressie: een poort die al in gebruik is liet `docker run` stilletjes op
	// EADDRINUSE sterven. De health-probe beantwoordde daarna vanaf de
	// reeds draaiende container op diezelfde poort, waardoor de
	// release-vergelijking 30 keer op een verkeerde release faalde in plaats
	// van op de echte oorzaak te wijzen.
	it("refuses to start the candidate on a port that is already in use", () => {
		const r = simulateBlueGreen("port-taken");
		expect(r.status, r.output).not.toBe(0);
		expect(r.output).toContain("already in use");
		// Er is geen kandidaat gestart, dus er is ook niets om te verwijderen.
		expect(r.calls).not.toContain("docker run");
		// De live release draait ongestoord door en nginx wijst nog steeds
		// naar de oude poort: geen halve cutover.
		expect(r.upstream).toContain("127.0.0.1:3002");
		expect(r.upstream).not.toContain("127.0.0.1:3003");
	});

	it("removes a compose replica that squats the candidate port and then deploys", () => {
		// Live op 3003, dus de kandidaat moet op 3002. Een compose-replica uit
		// deze checkout zit daar al: precies de situatie die de release tegenhield
		// totdat iemand de container met de hand verwijderde.
		const r = simulateBlueGreen("port-taken-compose", 3003);
		expect(r.status, r.output).toBe(0);
		expect(r.output).toContain(
			"Removing compose replica epicnext-cms on port 3002",
		);
		// Vóór het starten van de kandidaat, anders blijft 3002 bezet.
		expect(r.calls.indexOf("docker rm -f epicnext-cms\n")).toBeGreaterThan(-1);
		expect(r.calls.indexOf("docker rm -f epicnext-cms\n")).toBeLessThan(
			r.calls.indexOf("docker run -d --name epicnext-cms-app"),
		);
		expect(r.upstream).toContain("127.0.0.1:3002");
	});

	it("leaves a compose replica alone when it is the live release", () => {
		// De replica draait hier op 3003, de poort waar nginx naar wijst. Hoe
		// onheilijk een compose-container ook is, hij serveert het verkeer en
		// wordt dus niet weggenomen.
		const r = simulateBlueGreen("compose-live", 3003);
		expect(r.status, r.output).toBe(0);
		expect(r.calls).not.toContain("docker rm -f epicnext-cms\n");
		expect(r.upstream).toContain("127.0.0.1:3002");
	});

	it.each([
		"run-failure",
		"health-failure",
		"smoke-failure",
		"release-failure",
	])(
		"never stops the live release when the candidate fails on %s",
		(scenario) => {
			const r = simulateBlueGreen(scenario);
			expect(r.status, r.output).not.toBe(0);
			// Dit is de hele belofte: een mislukte release kost tijd, geen downtime.
			expect(r.calls).not.toContain("docker stop epicnext-cms-app");
			expect(r.calls).not.toContain("nginx -s reload");
			expect(r.upstream).toContain("127.0.0.1:3002");
			expect(r.green).toBeNull();
			expect(r.output).toContain("the live release was never stopped");
		},
		30000,
	);

	it("leaves the live release alone when migrations fail", () => {
		// Migraties draaien vóórdat de blue/green-detectie, dus er is op dat
		// moment simpelweg nog niets om terug te draaien.
		const r = simulateBlueGreen("migration-failure");
		expect(r.status, r.output).not.toBe(0);
		expect(r.calls).not.toContain("docker stop");
		expect(r.calls).not.toContain("docker run");
		expect(r.calls).not.toContain("nginx -s reload");
		expect(r.upstream).toContain("127.0.0.1:3002");
		expect(r.app).toBe("old");
	});

	it("keeps the live release serving when nginx rejects the new upstream", () => {
		const r = simulateBlueGreen("nginx-reject");
		expect(r.status, r.output).not.toBe(0);
		expect(r.calls).not.toContain("docker stop epicnext-cms-app");
		expect(r.calls).not.toContain("nginx -s reload");
		// De upstream is teruggezet op wat er stond.
		expect(r.upstream).toContain("127.0.0.1:3002");
		expect(r.output).toContain("restoring the previous one");
	});
});
