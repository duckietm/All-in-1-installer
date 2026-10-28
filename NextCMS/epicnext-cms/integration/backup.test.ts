import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import {
	GenericContainer,
	type StartedTestContainer,
	Wait,
} from "testcontainers";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	createBackup,
	drillBackup,
	IMAGE,
} from "../scripts/backup/database.mjs";

let maria: StartedTestContainer | undefined;
let connection: mysql.Connection | undefined;
let directory: string;
let artifact: string;
let database: {
	host: string;
	port: number;
	user: string;
	password: string;
	database: string;
};
let roots: Record<string, string>;

beforeAll(async () => {
	directory = await mkdtemp(path.join(tmpdir(), "cms-backup-integration-"));
	const password = randomUUID();
	// A real Docker failure fails this suite; there is no environment-dependent skip.
	maria = await new GenericContainer(IMAGE)
		.withCopyContentToContainer([
			{
				content: password,
				target: "/run/secrets/backup-password",
				mode: 0o600,
			},
		])
		.withEnvironment({
			MARIADB_ROOT_PASSWORD_FILE: "/run/secrets/backup-password",
			MARIADB_DATABASE: "cms_backup_fixture",
		})
		.withExposedPorts(3306)
		.withHealthCheck({
			test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"],
			interval: 1000,
			timeout: 5000,
			retries: 90,
			startPeriod: 1000,
		})
		.withWaitStrategy(Wait.forHealthCheck())
		.withStartupTimeout(120_000)
		.start();
	database = {
		host: maria.getHost(),
		port: maria.getMappedPort(3306),
		user: "root",
		password,
		database: "cms_backup_fixture",
	};
	connection = await mysql.createConnection({
		...database,
		charset: "utf8mb4",
		supportBigNumbers: true,
		bigNumberStrings: true,
	});
	await connection.query(
		"CREATE TABLE parent (id BIGINT UNSIGNED PRIMARY KEY, title VARCHAR(255)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
	);
	await connection.query(
		"CREATE TABLE child (id INT PRIMARY KEY, parent_id BIGINT UNSIGNED, FOREIGN KEY (parent_id) REFERENCES parent(id)) ENGINE=InnoDB",
	);
	await connection.query("INSERT INTO parent VALUES (?, ?)", [
		"9007199254740993123",
		"Caffè 🏨 漢字",
	]);
	await connection.query("INSERT INTO child VALUES (1, ?)", [
		"9007199254740993123",
	]);
	await connection.query(
		"CREATE VIEW parent_titles AS SELECT id, title FROM parent",
	);
	await connection.query(
		"CREATE TRIGGER preserve_title BEFORE UPDATE ON parent FOR EACH ROW SET NEW.title = COALESCE(NEW.title, OLD.title)",
	);
	await connection.query(
		"CREATE PROCEDURE count_parents() SELECT COUNT(*) FROM parent",
	);
	await connection.query(
		"CREATE EVENT future_check ON SCHEDULE EVERY 1 DAY DISABLE DO SELECT 1",
	);
	roots = Object.fromEntries(
		["storage", "nitro", "swf", "gamedata"].map((key) => [
			key,
			path.join(directory, key),
		]),
	);
	for (const root of Object.values(roots)) await mkdir(root);
	await mkdir(path.join(roots.storage, "empty"));
	await writeFile(
		path.join(roots.storage, "fixture.bin"),
		Buffer.from([0, 128, 255, 42]),
	);
	await writeFile(
		path.join(roots.gamedata, "FurnitureData.json"),
		'{"caption":"Caffè 🏨 漢字"}',
	);
	artifact = path.join(directory, "artifact");
});

afterAll(async () => {
	await connection?.end();
	await maria?.stop();
	if (directory) await rm(directory, { recursive: true, force: true });
});

it("creates and restores a real database with UTF-8, large IDs, relationships and stored SQL objects, then rejects corruption", async () => {
	const manifest = await createBackup({
		database,
		roots,
		output: artifact,
		writersQuiesced: true,
	});
	expect(manifest.database.tables).toHaveLength(2);
	expect(manifest.database.objects).toEqual(
		expect.arrayContaining([
			{ kind: "VIEW", name: "parent_titles" },
			{ kind: "TRIGGER", name: "preserve_title" },
			{ kind: "PROCEDURE", name: "count_parents" },
			{ kind: "EVENT", name: "future_check" },
		]),
	);
	const verified = await drillBackup({ artifact });
	expect(verified.verified).toBe(true);
	expect(verified.database).toEqual(manifest.database);
	expect(verified.files).toBe(2);
	if (!connection) throw Error("Fixture database is unavailable");
	const [rows] = await connection.query(
		"SELECT CAST(parent.id AS CHAR) AS id, title FROM parent JOIN child ON child.parent_id = parent.id",
	);
	expect(rows).toEqual([{ id: "9007199254740993123", title: "Caffè 🏨 漢字" }]);
	const sqlPath = path.join(artifact, "database.sql");
	const sql = await readFile(sqlPath, "utf8");
	expect(sql).toContain("Caffè 🏨 漢字");
	const changed = sql.replace("Caffè 🏨 漢字", "Changed content");
	await writeFile(sqlPath, changed);
	await expect(drillBackup({ artifact })).rejects.toThrow();
	// Even with a recomputed file hash, the restored table checksum must disagree.
	const sqlEntry = manifest.entries.find(
		(entry: { path: string }) => entry.path === "database.sql",
	);
	if (!sqlEntry) throw Error("SQL manifest entry is missing");
	sqlEntry.bytes = Buffer.byteLength(changed);
	sqlEntry.sha256 = createHash("sha256").update(changed).digest("hex");
	await writeFile(
		path.join(artifact, "manifest.json"),
		JSON.stringify(manifest),
	);
	await expect(drillBackup({ artifact })).rejects.toThrow(
		"Restored database inventory",
	);
}, 240_000);
