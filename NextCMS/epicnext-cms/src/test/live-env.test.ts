import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadEnvForLiveTests } from "./live-env";

const ORIGINAL_ENV = { ...process.env };
const SANDBOX = "mysql://root@127.0.0.1:3307/habbo_sandbox?charset=utf8mb4";

/**
 * Run the helper against a temporary .env so the real project file is never
 * read and the ambient environment cannot leak in.
 */
function runWithDotEnv(dotEnv: string | null, shell: Record<string, string>) {
	const dir = mkdtempSync(join(tmpdir(), "live-env-test-"));
	const previousCwd = process.cwd();
	try {
		if (dotEnv !== null) writeFileSync(join(dir, ".env"), dotEnv);
		// process.chdir keeps process.cwd() inside the helper pointing at dir.
		process.chdir(dir);
		for (const key of Object.keys(process.env)) delete process.env[key];
		Object.assign(process.env, shell);
		loadEnvForLiveTests();
		return { ...process.env };
	} finally {
		process.chdir(previousCwd);
		rmSync(dir, { recursive: true, force: true });
	}
}

afterEach(() => {
	for (const key of Object.keys(process.env)) delete process.env[key];
	Object.assign(process.env, ORIGINAL_ENV);
});

describe("loadEnvForLiveTests", () => {
	// The suites these protect rewrite the catalog, delete duplicate
	// classnames and bulk-import thousands of rows. A single env var used to be
	// enough to aim them at the live hotel database.
	it("never inherits a production database from .env", () => {
		const env = runWithDotEnv(
			[
				"DATABASE_URL='mysql://cms:secret@db.example.nl:3306/habbo'",
				"HOTEL_NAME='Test Hotel'",
			].join("\n"),
			{},
		);
		expect(env.DATABASE_URL).toBe(SANDBOX);
		// Non-database settings still load, so the suites stay usable.
		expect(env.HOTEL_NAME).toBe("Test Hotel");
	});

	it("keeps an explicit shell override", () => {
		const env = runWithDotEnv(
			"DATABASE_URL='mysql://cms:secret@db.example.nl:3306/habbo'",
			{
				DATABASE_URL: "mysql://root@127.0.0.1:3399/other?charset=utf8mb4",
			},
		);
		expect(env.DATABASE_URL).toBe(
			"mysql://root@127.0.0.1:3399/other?charset=utf8mb4",
		);
	});

	it("treats any non-loopback database as production", () => {
		const env = runWithDotEnv(null, {
			DATABASE_URL: "mysql://user:pw@10.0.0.5:3306/habbo",
		});
		expect(env.DATABASE_URL).toBe(SANDBOX);
	});

	it("allows production only behind an explicit opt-in", () => {
		const production = "mysql://cms:secret@db.example.nl:3306/habbo";
		const env = runWithDotEnv(null, {
			DATABASE_URL: production,
			ALLOW_PRODUCTION_LIVE_DB: "1",
		});
		expect(env.DATABASE_URL).toBe(production);
	});

	it("stays on the sandbox when the opt-in is set but the URL is safe", () => {
		const env = runWithDotEnv(null, {
			DATABASE_URL: "mysql://root@127.0.0.1:3307/habbo_sandbox?charset=utf8mb4",
			ALLOW_PRODUCTION_LIVE_DB: "1",
		});
		expect(env.DATABASE_URL).toBe(SANDBOX);
	});

	it("supplies a sandbox when .env has no database at all", () => {
		const env = runWithDotEnv("HOTEL_NAME='Test Hotel'", {});
		expect(env.DATABASE_URL).toBe(SANDBOX);
	});

	it("strips quotes the way the previous inline loader did", () => {
		const env = runWithDotEnv(
			['AUTH_SECRET="quoted-secret"', "OTHER='single'"].join("\n"),
			{},
		);
		expect(env.AUTH_SECRET).toBe("quoted-secret");
		expect(env.OTHER).toBe("single");
	});
});

describe("live suites no longer inline the .env loader", () => {
	const suites = [
		"catalog-audit-repair-live",
		"catalog-audit-live",
		"clone-bulk-import-live",
		"clone-feasibility-live",
		"catalog-repair-direct-live",
		"catalog-asset-repair-live",
		"catalog-audit-summary-live",
	];

	it.each(suites)("%s delegates to the shared loader", (name) => {
		const source = readFileSync(
			resolve(process.cwd(), "src/lib/services", `${name}.test.ts`),
			"utf8",
		);
		// A bare assignment would overwrite an operator's explicit DATABASE_URL,
		// which is how production used to win.
		expect(source).not.toMatch(/process\.env\[m\[1\]\]\s*=/);
		expect(source).toContain("loadEnvForLiveTests()");
	});
});
