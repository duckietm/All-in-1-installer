import "./load-env";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mysqlConnectionUrl } from "./db-url";
import { splitSqlStatements } from "./sql-statements";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../drizzle/migrations");
const TRACKING_TABLE = "cms_migrations";

interface MigrationFile {
	id: string;
	name: string;
	sql: string;
}

function getDbConfig(): { url: string; database: string } {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL is required");
	const parsed = new URL(url);
	const dbName =
		decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "atomcms";
	return { url: mysqlConnectionUrl(url), database: dbName };
}

async function openConnection() {
	const { url } = getDbConfig();
	const mysql = await import("mysql2/promise");
	return mysql.createConnection(url);
}
void openConnection;

async function createTrackingTable(
	conn: import("mysql2/promise").Connection,
): Promise<void> {
	await conn.execute(
		`CREATE TABLE IF NOT EXISTS \`${TRACKING_TABLE}\` (
        id INT AUTO_INCREMENT PRIMARY KEY,
        migration VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
	);
}

async function getApplied(
	conn: import("mysql2/promise").Connection,
): Promise<Set<string>> {
	try {
		const [rows] = await conn.execute(
			`SELECT migration FROM \`${TRACKING_TABLE}\` ORDER BY id`,
		);
		return new Set((rows as { migration: string }[]).map((r) => r.migration));
	} catch {
		return new Set();
	}
}

function loadMigrations(): MigrationFile[] {
	const entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
	const files = entries
		.filter((e) => e.isFile() && e.name.endsWith(".sql"))
		.sort((a, b) => a.name.localeCompare(b.name));

	return files.map((f) => {
		const id = f.name.replace(/\.sql$/, "");
		const sql = readFileSync(resolve(MIGRATIONS_DIR, f.name), "utf-8");
		return { id, name: f.name, sql };
	});
}

async function apply(
	conn: import("mysql2/promise").Connection,
	migration: MigrationFile,
): Promise<void> {
	const statements = splitSqlStatements(migration.sql);

	for (const stmt of statements) {
		await conn.execute(stmt);
	}

	await conn.execute(
		`INSERT INTO \`${TRACKING_TABLE}\` (migration) VALUES (?)`,
		[migration.id],
	);
	console.log(`[migrate] Applied: ${migration.name}`);
}

async function main() {
	const mysql = await import("mysql2/promise");
	const { url } = getDbConfig();
	const conn = await mysql.createConnection(url);

	try {
		await createTrackingTable(conn);
		const applied = await getApplied(conn);

		if (process.argv[2] === "--status") {
			const all = loadMigrations();

			console.log("\nMigration status:\n");
			for (const m of all) {
				const done = applied.has(m.id);
				console.log(
					`  ${done ? "✓" : " "} ${m.name}${done ? "" : "  [PENDING]"}`,
				);
			}

			const pending = all.filter((m) => !applied.has(m.id));
			const total = all.length;
			const done = total - pending.length;
			console.log(`\n${done}/${total} applied, ${pending.length} pending\n`);
			return;
		}

		const pending = loadMigrations().filter((m) => !applied.has(m.id));

		if (pending.length === 0) {
			console.log("[migrate] All migrations already applied.");
			return;
		}

		console.log(`[migrate] Applying ${pending.length} migration(s)...\n`);
		for (const m of pending) {
			try {
				await apply(conn, m);
			} catch (err) {
				console.error(`[migrate] FAILED: ${m.name}`, err);
				process.exit(1);
			}
		}
		console.log("\n[migrate] Done.");
	} finally {
		await conn.end();
	}
}

main().catch((err) => {
	console.error("[migrate] Fatal:", err);
	process.exit(1);
});
