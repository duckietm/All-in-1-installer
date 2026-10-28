import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import mysql, { type Connection } from "mysql2/promise";
import {
	GenericContainer,
	Network,
	type StartedNetwork,
	type StartedTestContainer,
	Wait,
} from "testcontainers";
import { STAFF_ID, STAFF_USERNAME, seedDatabase } from "./schema";

const root = fileURLToPath(new URL("../../", import.meta.url));
const execute = promisify(execFile);
const image = process.env.NEWS_E2E_IMAGE;
const release = process.env.NEWS_E2E_RELEASE;
if (!image)
	throw Error(
		"NEWS_E2E_IMAGE is required: build the candidate image before running this test. Docker is mandatory.",
	);
if (!/^epicnext-cms:[a-zA-Z0-9_.-]+$/.test(image))
	throw Error("NEWS_E2E_IMAGE must name a local epicnext-cms candidate tag.");
if (release && !/^[0-9a-f]{40}$/.test(release))
	throw Error("NEWS_E2E_RELEASE must be a full commit SHA.");

// Never propagate checkout .env, NODE_OPTIONS, installation DB URLs or service tokens.
const inherited = (names: string[]): NodeJS.ProcessEnv => ({
	NODE_ENV: "test",
	...Object.fromEntries(
		names.flatMap((name) =>
			process.env[name] === undefined ? [] : [[name, process.env[name]]],
		),
	),
});
const hostEnv = inherited([
	"PATH",
	"Path",
	"SystemRoot",
	"ComSpec",
	"TEMP",
	"TMP",
	"TMPDIR",
	"HOME",
	"USERPROFILE",
	"LOCALAPPDATA",
]);
const dockerEnv = {
	...hostEnv,
	...inherited([
		"DOCKER_HOST",
		"DOCKER_CONTEXT",
		"DOCKER_CONFIG",
		"DOCKER_CERT_PATH",
		"DOCKER_TLS_VERIFY",
	]),
};
const secrets = Array.from({ length: 4 }, () =>
	randomBytes(32).toString("hex"),
);
const [databasePassword, redisPassword, staffPassword, authSecret] = secrets;
const redact = (text: string) =>
	secrets.reduce(
		(value, secret) => value.replaceAll(secret, "[fixture secret]"),
		text,
	);
const abort = new AbortController();
const onSignal = () => abort.abort();
process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);
let network: StartedNetwork | undefined;
let maria: StartedTestContainer | undefined;
let redis: StartedTestContainer | undefined;
let app: StartedTestContainer | undefined;
let database: Connection | undefined;
let proxy: Server | undefined;
let temporary: string | undefined;
let logs = "";

try {
	// Resolve the existing image before Testcontainers; starting by immutable ID cannot pull a tag.
	const inspected = await execute(
		"docker",
		["image", "inspect", image, "--format", "{{json .}}"],
		{ env: dockerEnv, timeout: 15_000 },
	);
	const candidate = JSON.parse(inspected.stdout) as {
		Id: string;
		Config: { Labels?: Record<string, string> };
	};
	if (!/^sha256:[0-9a-f]{64}$/.test(candidate.Id))
		throw Error("Candidate image identity is invalid");
	if (
		release &&
		candidate.Config.Labels?.["org.opencontainers.image.revision"] !== release
	)
		throw Error("Candidate image revision does not match NEWS_E2E_RELEASE");
	abort.signal.throwIfAborted();
	temporary = await mkdtemp(join(tmpdir(), "epicnext-news-e2e-"));
	// Fresh local-only TLS material never enters the repository or build artifacts.
	await execute(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-keyout",
			join(temporary, "localhost.key"),
			"-out",
			join(temporary, "localhost.crt"),
			"-days",
			"1",
			"-subj",
			"/CN=localhost",
			"-addext",
			"subjectAltName=IP:127.0.0.1,DNS:localhost",
		],
		{ cwd: temporary, env: hostEnv, timeout: 30_000, signal: abort.signal },
	);
	console.log("News browser gate: starting isolated MariaDB and Redis");
	network = await new Network().start();
	const services = await Promise.allSettled([
		new GenericContainer("mariadb:11.4.5")
			.withNetwork(network)
			.withNetworkAliases("news-db")
			.withEnvironment({
				MARIADB_ROOT_PASSWORD: randomBytes(32).toString("hex"),
				MARIADB_DATABASE: "news_e2e",
				MARIADB_USER: "news_e2e",
				MARIADB_PASSWORD: databasePassword,
			})
			.withExposedPorts(3306)
			.withHealthCheck({
				test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"],
				interval: 1000,
				timeout: 5000,
				retries: 60,
				startPeriod: 1000,
			})
			.withWaitStrategy(Wait.forHealthCheck())
			.withStartupTimeout(120_000)
			.start()
			.then((container) => {
				maria = container;
			}),
		new GenericContainer("redis:7.4.2-alpine")
			.withNetwork(network)
			.withNetworkAliases("news-redis")
			.withCommand(["redis-server", "--requirepass", redisPassword])
			.withExposedPorts(6379)
			.withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
			.withStartupTimeout(60_000)
			.start()
			.then((container) => {
				redis = container;
			}),
	]);
	for (const service of services)
		if (service.status === "rejected") throw service.reason;
	if (!maria || !redis) throw Error("Disposable services did not start");
	abort.signal.throwIfAborted();
	database = await mysql.createConnection({
		host: maria.getHost(),
		port: maria.getMappedPort(3306),
		user: "news_e2e",
		password: databasePassword,
		database: "news_e2e",
		charset: "utf8mb4",
		timezone: "Z",
		supportBigNumbers: true,
		bigNumberStrings: true,
	});
	await seedDatabase(database, staffPassword);
	await database.end();
	database = undefined;

	let upstream: URL | undefined;
	let origin = "";
	proxy = createServer(
		{
			cert: await readFile(join(temporary, "localhost.crt")),
			key: await readFile(join(temporary, "localhost.key")),
		},
		(request, response) => {
			if (!upstream || request.headers.host !== new URL(origin).host) {
				response.writeHead(503);
				response.end();
				return;
			}
			// A real local TLS edge, with the same forwarded-host/proto contract as deployment.
			const headers = { ...request.headers };
			delete headers["cf-connecting-ip"];
			delete headers["x-real-client-ip"];
			headers["x-forwarded-for"] = "127.0.0.1";
			headers["x-real-ip"] = "127.0.0.1";
			headers["x-forwarded-host"] = new URL(origin).host;
			headers["x-forwarded-proto"] = "https";
			const forwarded = httpRequest(
				{
					hostname: upstream.hostname,
					port: upstream.port,
					path: request.url,
					method: request.method,
					headers,
				},
				(received) => {
					response.writeHead(received.statusCode ?? 502, received.headers);
					received.pipe(response);
				},
			);
			forwarded.on("error", () => {
				if (!response.headersSent) response.writeHead(502);
				response.end();
			});
			request.on("aborted", () => forwarded.destroy());
			request.pipe(forwarded);
		},
	);
	proxy.listen(0, "127.0.0.1");
	await once(proxy, "listening");
	const address = proxy.address();
	if (!address || typeof address === "string")
		throw Error("Local TLS listener is unavailable");
	origin = `https://127.0.0.1:${address.port}`;
	console.log("News browser gate: starting the production candidate image");
	app = await new GenericContainer(candidate.Id.slice("sha256:".length))
		.withNetwork(network)
		.withEnvironment({
			NODE_ENV: "production",
			HOSTNAME: "0.0.0.0",
			PORT: "3002",
			DATABASE_URL: `mysql://news_e2e:${databasePassword}@news-db:3306/news_e2e`,
			REDIS_URL: `redis://:${redisPassword}@news-redis:6379/0`,
			HOTEL_NAME: "News browser fixture",
			AUTH_SECRET: authSecret,
			APP_URL: origin,
			NEXT_PUBLIC_APP_URL: origin,
			AUTH_URL: origin,
			RCON_HOST: "127.0.0.1",
			RCON_PORT: "9",
			RCON_TIMEOUT_MS: "100",
			RCON_MAX_RETRIES: "1",
			IMAGING_UPSTREAM_URL: "http://127.0.0.1:9",
			LOG_LEVEL: "warn",
		})
		.withExposedPorts(3002)
		.withWaitStrategy(Wait.forHttp("/api/health", 3002).forStatusCode(200))
		.withStartupTimeout(120_000)
		.withLogConsumer((stream) =>
			stream.on("data", (chunk: Buffer) => {
				logs = (logs + chunk.toString()).slice(-2_000_000);
			}),
		)
		.start();
	upstream = new URL(`http://${app.getHost()}:${app.getMappedPort(3002)}`);
	abort.signal.throwIfAborted();
	const health = (await fetch(new URL("/api/health", upstream), {
		signal: AbortSignal.timeout(10_000),
	}).then((response) => response.json())) as {
		status?: string;
		database?: boolean;
		redis?: boolean;
	};
	if (
		health.status !== "ok" ||
		health.database !== true ||
		health.redis !== true
	)
		throw Error("Candidate health does not confirm both disposable services");
	const fixturePath = join(temporary, "fixture.json");
	await writeFile(
		fixturePath,
		JSON.stringify({
			username: STAFF_USERNAME,
			userId: STAFF_ID,
			password: staffPassword,
			database: {
				host: maria.getHost(),
				port: maria.getMappedPort(3306),
				user: "news_e2e",
				password: databasePassword,
				database: "news_e2e",
			},
			redis: {
				host: redis.getHost(),
				port: redis.getMappedPort(6379),
				password: redisPassword,
			},
		}),
		{ mode: 0o600 },
	);
	console.log(
		"News browser gate: login, draft, preview, publish and anonymous read",
	);
	const child = spawn(
		process.execPath,
		[
			resolve(root, "node_modules/@playwright/test/cli.js"),
			"test",
			"--config",
			"e2e/news-real/playwright.config.ts",
		],
		{
			cwd: root,
			env: {
				...hostEnv,
				...inherited([
					"DISPLAY",
					"XAUTHORITY",
					"PLAYWRIGHT_BROWSERS_PATH",
					"UI_TEST_BROWSER_PATH",
					"CI",
				]),
				NEWS_E2E_FIXTURE: fixturePath,
				NEWS_E2E_BASE_URL: origin,
			},
			stdio: "inherit",
			signal: abort.signal,
		},
	);
	const [code] = (await once(child, "exit")) as [number | null];
	if (code !== 0)
		throw Error(`Real news browser suite failed (exit ${code ?? "signal"})`);
	console.log("News browser gate passed");
} catch (error) {
	console.error(
		redact(
			error instanceof Error ? (error.stack ?? error.message) : String(error),
		),
	);
	process.exitCode = 1;
} finally {
	// Stop only objects created by this run. Testcontainers' resource reaper also owns them.
	const cleanups: Array<[string, () => Promise<unknown>]> = [
		[
			"TLS proxy",
			async () => {
				proxy?.closeAllConnections();
				if (proxy)
					await new Promise<void>((done) => proxy?.close(() => done()));
			},
		],
		["candidate", async () => app?.stop({ timeout: 10_000 })],
		["database connection", async () => database?.end()],
		["Redis", async () => redis?.stop()],
		["MariaDB", async () => maria?.stop()],
		["network", async () => network?.stop()],
		[
			"temporary credentials",
			async () => {
				if (!temporary) return;
				if (
					dirname(resolve(temporary)) !== resolve(tmpdir()) ||
					!basename(temporary).startsWith("epicnext-news-e2e-")
				)
					throw Error(
						"Temporary credentials path escaped the fixture directory",
					);
				await rm(temporary, { recursive: true, force: true });
			},
		],
	];
	for (const [name, cleanup] of cleanups) {
		try {
			await cleanup();
		} catch (error) {
			console.error(`Cleanup failed for ${name}: ${redact(String(error))}`);
			process.exitCode = 1;
		}
	}
	await mkdir(resolve(root, "test-results/news-real"), { recursive: true });
	await writeFile(
		resolve(root, "test-results/news-real/server.log"),
		redact(logs),
	);
	process.removeListener("SIGINT", onSignal);
	process.removeListener("SIGTERM", onSignal);
}
