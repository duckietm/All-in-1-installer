import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Sandbox database for the live suites. Production runs on port 3306; the
 * throwaway MariaDB used by the rehearsal suites listens on 3307.
 */
export const SANDBOX_DATABASE_URL =
	"mysql://root@127.0.0.1:3307/habbo_sandbox?charset=utf8mb4";

/**
 * Load .env for the live suites without ever pointing them at production.
 *
 * Every live suite used to read .env with a bare
 * `process.env[key] = value`, which overwrites whatever the shell already set.
 * That made the DATABASE_URL from the production .env authoritative: setting
 * RUN_CATALOG_AUDIT_LIVE=1 pointed three suites — catalog-audit-repair-live,
 * catalog-repair-direct-live and clone-bulk-import-live — at the live hotel
 * database, where they rewrite the catalog, delete duplicate classnames and
 * bulk-import thousands of rows. The failure mode was silent: the gate is a
 * single environment variable, and nothing in the suite said the target was
 * production.
 *
 * Rules now:
 *   1. Values already present in the real environment win, so an explicit
 *      DATABASE_URL on the command line is always respected.
 *   2. DATABASE_URL defaults to the sandbox, never to production.
 *   3. Targeting production requires ALLOW_PRODUCTION_LIVE_DB=1 and says so
 *      loudly, because it is destructive and not undoable.
 */
export function loadEnvForLiveTests(): void {
	const allowProduction = process.env.ALLOW_PRODUCTION_LIVE_DB === "1";
	const envFile = resolve(process.cwd(), ".env");

	if (existsSync(envFile)) {
		for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
			const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
			if (!match) continue;
			let value = match[2].trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			// Already-set values win: the shell is a deliberate override.
			if (process.env[match[1]] === undefined) {
				process.env[match[1]] = value;
			}
		}
	}

	const databaseUrl = process.env.DATABASE_URL ?? "";
	const targetsProduction =
		databaseUrl.includes(":3306") ||
		(databaseUrl.includes("@") && !databaseUrl.includes("127.0.0.1"));

	if (allowProduction) {
		if (targetsProduction) {
			console.warn(
				"[live-test] ALLOW_PRODUCTION_LIVE_DB=1 and DATABASE_URL points at " +
					"a remote database. This suite repairs the catalog in place.",
			);
		}
		return;
	}

	if (targetsProduction || !databaseUrl) {
		process.env.DATABASE_URL = SANDBOX_DATABASE_URL;
		console.warn(
			`[live-test] redirected DATABASE_URL to the sandbox at ${SANDBOX_DATABASE_URL}. ` +
				"Set ALLOW_PRODUCTION_LIVE_DB=1 to override.",
		);
	}
}
