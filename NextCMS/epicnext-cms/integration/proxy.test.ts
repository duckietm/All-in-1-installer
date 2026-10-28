import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	GenericContainer,
	type StartedTestContainer,
	Wait,
} from "testcontainers";
import { afterAll, beforeAll, expect, it } from "vitest";

const exec = promisify(execFile);
const containers: StartedTestContainer[] = [];
let temporary: string;
let certificate: Buffer;
let key: Buffer;
let peer: string;
let direct: StartedTestContainer;
const spoofed = {
	Host: "hotel.example",
	"X-Forwarded-For": "198.51.100.40",
	"X-Real-IP": "198.51.100.41",
	"CF-Connecting-IP": "198.51.100.42",
	"X-Real-Client-IP": "198.51.100.43",
	Forwarded: "for=198.51.100.44",
	"X-Forwarded-Proto": "http",
	"X-Forwarded-Host": "attacker.invalid",
};
function get(container: StartedTestContainer, headers = spoofed) {
	return new Promise<{ status: number; body: string }>((resolve, reject) => {
		const req = request(
			{
				hostname: container.getHost(),
				port: container.getMappedPort(443),
				path: "/",
				rejectUnauthorized: false,
				headers,
				timeout: 5000,
			},
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					body += chunk;
				});
				res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
			},
		);
		req.on("error", reject);
		req.on("timeout", () => req.destroy(new Error("Proxy fixture timeout")));
		req.end();
	});
}
async function start(template: string, trustedPeer?: string) {
	let config = await readFile(`deployment/proxy/${template}`, "utf8");
	if (trustedPeer)
		config = config.replaceAll(
			"203.0.113.10/32",
			`${trustedPeer}/${isIP(trustedPeer) === 6 ? 128 : 32}`,
		);
	config = config
		.replaceAll(
			"/etc/letsencrypt/live/hotel.example/fullchain.pem",
			"/etc/nginx/test.pem",
		)
		.replaceAll(
			"/etc/letsencrypt/live/hotel.example/privkey.pem",
			"/etc/nginx/test.key",
		);
	const inherited = template.includes("direct")
		? "set_real_ip_from 0.0.0.0/0; real_ip_header X-Real-IP;"
		: "";
	const fixture = `${inherited}\n${config}\nserver { listen 127.0.0.1:3002; location / { default_type application/json; return 200 '{"xff":"$http_x_forwarded_for","real":"$http_x_real_ip","cf":"$http_cf_connecting_ip","derived":"$http_x_real_client_ip","forwarded":"$http_forwarded","host":"$http_host","proto":"$http_x_forwarded_proto"}'; } }`;
	const container = await new GenericContainer("nginx:1.28-alpine")
		.withCopyContentToContainer([
			{ content: fixture, target: "/etc/nginx/conf.d/default.conf" },
			{ content: certificate, target: "/etc/nginx/test.pem" },
			{ content: key, target: "/etc/nginx/test.key" },
		])
		.withExposedPorts(443)
		.withWaitStrategy(Wait.forLogMessage("start worker processes"))
		.withStartupTimeout(60000)
		.start();
	containers.push(container);
	return container;
}
beforeAll(async () => {
	temporary = await mkdtemp(join(tmpdir(), "cms-proxy-integration-"));
	await exec(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-days",
			"1",
			"-subj",
			"/CN=hotel.example",
			"-keyout",
			join(temporary, "key.pem"),
			"-out",
			join(temporary, "cert.pem"),
		],
		{ timeout: 15000 },
	);
	certificate = await readFile(join(temporary, "cert.pem"));
	key = await readFile(join(temporary, "key.pem"));
	direct = await start("nginx-direct.example.conf");
}, 120000);
afterAll(async () => {
	await Promise.allSettled(containers.map((container) => container.stop()));
	if (temporary) await rm(temporary, { recursive: true, force: true });
});
it("replaces forged forwarding headers with the original peer even with an inherited real-IP rule", async () => {
	const response = await get(direct);
	expect(response.status).toBe(200);
	const headers = JSON.parse(response.body);
	peer = headers.xff;
	expect(isIP(peer)).toBeGreaterThan(0);
	expect(Object.values(spoofed)).not.toContain(peer);
	expect(headers).toEqual({
		xff: peer,
		real: peer,
		cf: "",
		derived: "",
		forwarded: "",
		host: "hotel.example",
		proto: "https",
	});
});
it("rejects a direct client when the remote edge has not been trusted", async () => {
	const restricted = await start("nginx-trusted-proxy.example.conf");
	expect((await get(restricted)).status).toBe(403);
});
it("accepts the verified client address only through an explicitly trusted peer", async () => {
	if (!peer) peer = JSON.parse((await get(direct)).body).xff;
	const trusted = await start("nginx-trusted-proxy.example.conf", peer);
	const response = await get(trusted);
	expect(response.status).toBe(200);
	expect(JSON.parse(response.body)).toEqual({
		xff: spoofed["X-Forwarded-For"],
		real: spoofed["X-Forwarded-For"],
		cf: "",
		derived: "",
		forwarded: "",
		host: "hotel.example",
		proto: "https",
	});
});
