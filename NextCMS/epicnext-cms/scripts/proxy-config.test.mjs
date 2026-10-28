import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

const root = process.cwd();
const hasCompose =
	spawnSync("docker", ["compose", "version"], {
		encoding: "utf8",
		timeout: 10_000,
	}).status === 0;

it.skipIf(!hasCompose)(
	"loads the loopback override from .env for the cms service without changing mounts or host networking",
	() => {
		const directory = mkdtempSync(path.join(tmpdir(), "cms-proxy-config-"));
		try {
			mkdirSync(path.join(directory, "deployment/proxy"), { recursive: true });
			copyFileSync(
				path.join(root, "docker-compose.yml"),
				path.join(directory, "docker-compose.yml"),
			);
			copyFileSync(
				path.join(root, "deployment/proxy/compose.loopback.yml"),
				path.join(directory, "deployment/proxy/compose.loopback.yml"),
			);
			writeFileSync(
				path.join(directory, ".env"),
				[
					"COMPOSE_FILE=docker-compose.yml:deployment/proxy/compose.loopback.yml",
					"COMPOSE_PATH_SEPARATOR=:",
					"CMS_RELEASE=reviewed-release",
					"HOSTNAME=0.0.0.0",
					"PORT=9999",
					"HOTEL_NAME=Proxy fixture",
					"DATABASE_URL=mysql://fixture:fixture@127.0.0.1/fixture",
				].join("\n"),
			);
			const environment = { ...process.env };
			for (const key of Object.keys(environment))
				if (
					key.startsWith("COMPOSE_") ||
					["CMS_RELEASE", "HOSTNAME", "PORT"].includes(key)
				)
					delete environment[key];
			// `cms` is behind the `cms` profile so a bare `docker compose up -d`
			// can never squat port 3002 on a CI-managed host. Selecting the
			// profile here keeps the loopback/port-override contract under test.
			const result = spawnSync(
				"docker",
				["compose", "--profile", "cms", "config", "--format", "json"],
				{ cwd: directory, env: environment, encoding: "utf8", timeout: 15_000 },
			);
			expect(result.status, result.stderr).toBe(0);
			const config = JSON.parse(result.stdout);
			const cms = config.services.cms;
			expect(cms.environment.HOSTNAME).toBe("127.0.0.1");
			expect(cms.environment.PORT).toBe("3002");
			expect(cms.network_mode).toBe("host");
			expect(cms.ports).toBeUndefined();
			expect(cms.image).toBe("epicnext-cms:reviewed-release");
			expect(cms.healthcheck.test).toEqual([
				"CMD",
				"node",
				"-e",
				"fetch('http://127.0.0.1:3002/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
			]);
			expect(cms.volumes.map((volume) => volume.target).sort()).toEqual([
				"/app/public/nitro-assets",
				"/app/public/swf",
				"/app/storage",
				"/var/www/Gamedata",
			]);
			expect(cms.environment.DATABASE_URL).toBe(
				"mysql://fixture:fixture@127.0.0.1/fixture",
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	},
	30_000,
);
