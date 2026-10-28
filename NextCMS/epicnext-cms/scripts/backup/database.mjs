import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createArtifact, restoreFiles, verifyArtifact } from "./core.mjs";

export const IMAGE = "mariadb:11.4.5";
const failure = () =>
	Error(
		"MariaDB backup operation failed; no credentials or server output were logged",
	);
const quote = (value) =>
	`"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const identifier = (value) => {
	if (
		typeof value !== "string" ||
		[...value].some((character) => character.charCodeAt(0) < 32)
	)
		throw failure();
	return `\`${value.replaceAll("`", "``")}\``;
};

export function validateDatabase(config) {
	if (
		!config ||
		Object.keys(config).some(
			(key) => !["host", "port", "user", "password", "database"].includes(key),
		) ||
		!Number.isInteger(config.port) ||
		config.port < 1 ||
		config.port > 65535
	)
		throw failure();
	for (const key of ["host", "user", "password", "database"])
		if (
			typeof config[key] !== "string" ||
			!config[key] ||
			[...config[key]].some((character) => character.charCodeAt(0) < 32)
		)
			throw failure();
	if (
		!/^[a-zA-Z0-9_]+$/.test(config.database) ||
		["mysql", "sys", "information_schema", "performance_schema"].includes(
			config.database.toLowerCase(),
		)
	)
		throw failure();
	return config;
}

export function credentialOptions(config) {
	validateDatabase(config);
	return `[client]\nhost=${quote(config.host)}\nport=${config.port}\nuser=${quote(config.user)}\npassword=${quote(config.password)}\nprotocol=tcp\ndefault-character-set=utf8mb4\n`;
}

export function dockerEnvironment(source = process.env) {
	const keys = [
		"PATH",
		"Path",
		"SystemRoot",
		"SystemDrive",
		"TEMP",
		"TMP",
		"HOME",
		"USERPROFILE",
		"DOCKER_HOST",
		"DOCKER_CONTEXT",
		"DOCKER_CONFIG",
		"DOCKER_TLS_VERIFY",
		"DOCKER_CERT_PATH",
	];
	return Object.fromEntries(
		keys
			.filter((key) => source[key] !== undefined)
			.map((key) => [key, source[key]]),
	);
}

async function docker(args, { input, output, timeout = 1_800_000 } = {}) {
	const file = output ? await open(output, "wx", 0o600) : undefined;
	try {
		const child = spawn("docker", args, {
			env: dockerEnvironment(),
			windowsHide: true,
			stdio: [input ? "pipe" : "ignore", file ? file.fd : "pipe", "ignore"],
		});
		let stdout = "";
		if (!file)
			child.stdout.on("data", (chunk) => {
				stdout += chunk.toString("utf8");
				if (stdout.length > 16 * 1024 * 1024) child.kill();
			});
		const timer = setTimeout(() => child.kill(), timeout);
		const completion = new Promise((resolve, reject) => {
			child.once("error", () => reject(failure()));
			child.once("close", (code) =>
				code === 0 ? resolve(stdout) : reject(failure()),
			);
		});
		try {
			await Promise.all([
				completion,
				input
					? pipeline(createReadStream(input), child.stdin)
					: Promise.resolve(),
			]);
			return stdout;
		} catch {
			child.kill();
			throw failure();
		} finally {
			clearTimeout(timer);
		}
	} finally {
		await file?.close();
	}
}

async function credentials(config, use) {
	const directory = await mkdtemp(path.join(tmpdir(), "cms-backup-private-"));
	try {
		await chmod(directory, 0o700);
		await writeFile(
			path.join(directory, "client.cnf"),
			credentialOptions(config),
			{ flag: "wx", mode: 0o600 },
		);
		return await use(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

async function sourceClient(directory, program, args, options) {
	const name = `cms-backup-client-${randomUUID()}`;
	try {
		return await docker(
			[
				"run",
				"--rm",
				"--name",
				name,
				"--network",
				"host",
				"--mount",
				`type=bind,src=${directory},dst=/run/backup,readonly`,
				"--entrypoint",
				program,
				IMAGE,
				"--defaults-file=/run/backup/client.cnf",
				...args,
			],
			options,
		);
	} finally {
		await docker(["rm", "-f", "-v", name], { timeout: 15_000 }).catch(() => {});
	}
}

async function inventory(query, database) {
	const schema = literal(database);
	const records = await query(
		`SELECT JSON_OBJECT('kind', TABLE_TYPE, 'name', TABLE_NAME, 'engine', ENGINE) FROM information_schema.TABLES WHERE TABLE_SCHEMA=${schema} UNION ALL SELECT JSON_OBJECT('kind', ROUTINE_TYPE, 'name', ROUTINE_NAME, 'engine', NULL) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=${schema} UNION ALL SELECT JSON_OBJECT('kind', 'TRIGGER', 'name', TRIGGER_NAME, 'engine', NULL) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=${schema} UNION ALL SELECT JSON_OBJECT('kind', 'EVENT', 'name', EVENT_NAME, 'engine', NULL) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=${schema}`,
	);
	const objects = records
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	if (
		objects.some(
			(object) => object.kind === "BASE TABLE" && object.engine !== "InnoDB",
		)
	)
		throw Error("Only InnoDB tables are supported by this snapshot workflow");
	objects.sort((a, b) =>
		`${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`, "en"),
	);
	const tables = [];
	for (const table of objects.filter(
		(object) => object.kind === "BASE TABLE",
	)) {
		const qualified = `${identifier(database)}.${identifier(table.name)}`;
		const result = (
			await query(
				`SELECT CAST(COUNT(*) AS CHAR) FROM ${qualified}; CHECKSUM TABLE ${qualified} EXTENDED;`,
			)
		)
			.trim()
			.split("\n");
		const checksum = result[1]?.split("\t").at(-1)?.trim();
		if (!/^\d+$/.test(result[0]) || !/^\d+$/.test(checksum ?? ""))
			throw failure();
		tables.push({ name: table.name, rows: result[0], checksum });
	}
	if (!tables.length)
		throw Error("The backup database must contain at least one InnoDB table");
	return {
		database,
		objects: objects.map(({ kind, name }) => ({ kind, name })),
		tables,
	};
}

const queryArgs = (sql) => [
	"--batch",
	"--raw",
	"--skip-column-names",
	"--execute",
	sql,
];

export async function createBackup({
	database,
	roots,
	output,
	writersQuiesced,
}) {
	if (writersQuiesced !== true)
		throw Error(
			"Pause all database and file writers, then pass --writers-quiesced",
		);
	validateDatabase(database);
	return credentials(database, (directory) =>
		createArtifact({ roots, output }, async (target) => {
			const query = (sql) => sourceClient(directory, "mariadb", queryArgs(sql));
			const before = await inventory(query, database.database);
			await sourceClient(
				directory,
				"mariadb-dump",
				[
					"--single-transaction",
					"--quick",
					"--skip-lock-tables",
					"--routines",
					"--events",
					"--triggers",
					"--hex-blob",
					"--tz-utc",
					"--skip-comments",
					"--max-allowed-packet=512M",
					"--databases",
					database.database,
				],
				{ output: target },
			);
			const after = await inventory(query, database.database);
			if (JSON.stringify(before) !== JSON.stringify(after))
				throw Error(
					"Database changed during backup; keep every writer paused and retry",
				);
			return before;
		}),
	);
}

export async function drillBackup({ artifact }) {
	const expected = await verifyArtifact(artifact);
	const database = expected.database?.database;
	const password = randomUUID();
	const config = validateDatabase({
		host: "127.0.0.1",
		port: 3306,
		user: "root",
		password,
		database,
	});
	return credentials(config, async (directory) => {
		const name = `cms-backup-drill-${randomUUID()}`;
		const query = (sql) =>
			docker([
				"exec",
				name,
				"mariadb",
				"--defaults-file=/run/backup/client.cnf",
				...queryArgs(sql),
			]);
		let started = false;
		try {
			await restoreFiles(artifact, path.join(directory, "restored"));
			await writeFile(path.join(directory, "password"), password, {
				flag: "wx",
				mode: 0o600,
			});
			await docker(
				[
					"run",
					"-d",
					"--name",
					name,
					"--label",
					"cms.backup-drill=true",
					"--network",
					"none",
					"--mount",
					`type=bind,src=${directory},dst=/run/backup,readonly`,
					"-e",
					"MARIADB_ROOT_PASSWORD_FILE=/run/backup/password",
					IMAGE,
					"--character-set-server=utf8mb4",
					"--collation-server=utf8mb4_unicode_ci",
					"--event-scheduler=OFF",
					"--max-allowed-packet=512M",
				],
				{ timeout: 120_000 },
			);
			started = true;
			let ready = false;
			for (let attempt = 0; attempt < 90; attempt++) {
				try {
					await docker(
						[
							"exec",
							name,
							"mariadb-admin",
							"--defaults-file=/run/backup/client.cnf",
							"ping",
							"--silent",
						],
						{ timeout: 5_000 },
					);
					ready = true;
					break;
				} catch {
					await delay(1000);
				}
			}
			if (!ready) throw failure();
			// Import over stdin; no network, published port or production filesystem mount.
			await docker(
				[
					"exec",
					"-i",
					name,
					"mariadb",
					"--defaults-file=/run/backup/client.cnf",
					"--binary-mode",
				],
				{ input: path.join(artifact, "database.sql") },
			);
			const actual = await inventory(query, database);
			if (JSON.stringify(actual) !== JSON.stringify(expected.database))
				throw Error("Restored database inventory does not match the backup");
			return {
				verified: true,
				database: actual,
				files: expected.entries.filter(
					(entry) => entry.type === "file" && entry.path.startsWith("files/"),
				).length,
			};
		} finally {
			const cleanup = docker(["rm", "-f", "-v", name], { timeout: 30_000 });
			if (started) await cleanup;
			else await cleanup.catch(() => {});
		}
	});
}
