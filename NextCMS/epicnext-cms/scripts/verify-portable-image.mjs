// Runs only on a Linux Docker host. No production DB, network or volumes are used.
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { verifyRuntimeMetadata } from "./verify-runtime-metadata.mjs";

const [image, release] = process.argv.slice(2);
if (!image || !/^[0-9a-f]{40}$/.test(release ?? ""))
	throw new Error("Usage: verify-portable-image.mjs IMAGE COMMIT");
const docker = (...args) =>
	execFileSync("docker", args, { encoding: "utf8", timeout: 60000 }).trim();
const id = docker("image", "inspect", "--format", "{{.Id}}", image);
const inspect = JSON.parse(docker("image", "inspect", image))[0];
if (
	(inspect.Config.Env ?? []).some((value) =>
		/^(DATABASE_URL|AUTH_SECRET|HOTEL_NAME)=/.test(value),
	)
)
	throw new Error("Image contains installation configuration");
docker(
	"run",
	"--rm",
	"--entrypoint",
	"node",
	image,
	"-e",
	'for(const p of [".env",".env.local",".env.production",".env.production.local"]){if(require("fs").existsSync(p))throw Error("Environment file in image: "+p)}',
);
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=",
	"base64",
);
const requests = [];
const upstream = createServer((req, res) => {
	requests.push(req.url);
	res.writeHead(200, { "content-type": "image/png" });
	res.end(png);
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${upstream.address().port}`;
try {
	for (const hotel of ["alpha", "beta"]) {
		const reservation = createServer();
		await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
		const port = reservation.address().port;
		await new Promise((resolve) => reservation.close(resolve));
		const name = `cms-portability-${process.pid}-${hotel}`;
		const base = `http://127.0.0.1:${port}`;
		try {
			docker(
				"run",
				"--detach",
				"--name",
				name,
				"--network",
				"host",
				"--env",
				`PORT=${port}`,
				"--env",
				"HOSTNAME=127.0.0.1",
				"--env",
				`HOTEL_NAME=Fixture ${hotel}`,
				"--env",
				`APP_URL=${base}`,
				"--env",
				`AUTH_SECRET=portability-${hotel}-not-a-production-secret-000000`,
				"--env",
				"DATABASE_URL=mysql://fixture:fixture@127.0.0.1:9/fixture",
				"--env",
				"DATABASE_CONNECT_TIMEOUT_MS=500",
				"--env",
				"RCON_PORT=9",
				"--env",
				"RCON_TIMEOUT_MS=100",
				"--env",
				"RCON_MAX_RETRIES=1",
				"--env",
				"AUTH_TRUST_HOST=true",
				"--env",
				`IMAGER_URL=${origin}/${hotel}/avatar`,
				"--env",
				`BADGE_URL=${origin}/${hotel}/badges`,
				id,
			);
			let ready = false;
			for (let attempt = 0; attempt < 30; attempt++) {
				try {
					const r = await fetch(`${base}/cms_api/health`, {
						signal: AbortSignal.timeout(2000),
					});
					if ((await r.json()).release === release) {
						ready = true;
						break;
					}
				} catch {}
				await delay(1000);
			}
			if (!ready) throw new Error(`${hotel}: expected HTTP release not served`);
			await verifyRuntimeMetadata(base, hotel);
			const avatar = await fetch(
				`${base}/cms_api/imaging/avatar?figure=hd-180-1&img_format=png`,
				{ signal: AbortSignal.timeout(15000) },
			);
			if (
				!avatar.ok ||
				!requests.some((url) => url.startsWith(`/${hotel}/avatar?`))
			)
				throw new Error(`${hotel}: wrong avatar upstream`);
			const badge = await fetch(`${base}/cms_api/imaging/badge?code=ADM`, {
				redirect: "manual",
				signal: AbortSignal.timeout(15000),
			});
			if (badge.headers.get("location") !== `${origin}/${hotel}/badges/ADM.gif`)
				throw new Error(`${hotel}: wrong badge URL`);
			console.log(
				`Verified ${hotel}: same image ${id}, runtime avatar and badge configuration, release ${release}`,
			);
		} catch (error) {
			console.error(docker("logs", name, "--tail", "40"));
			throw error;
		} finally {
			try {
				docker("rm", "--force", name);
			} catch {}
		}
	}
} finally {
	await new Promise((resolve) => upstream.close(resolve));
}
