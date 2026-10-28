import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import type { ResultSetHeader } from "mysql2";
import mysql from "mysql2/promise";
import * as relations from "@/db/relations";
import * as schema from "@/db/schema";
import { env } from "@/env";
import { resolveConnectionLimit } from "@/lib/db-pool";

import { instrumentDatabase } from "@/lib/performance-diagnostics";

const fullSchema = { ...schema, ...relations };

const globalForDb = globalThis as unknown as {
	db?: ReturnType<typeof createDb>;
};

function createDb() {
	const url = new URL(env.DATABASE_URL);
	const isBuild =
		process.env.NEXT_PHASE === "phase-production-build" ||
		process.env.NEXT_PHASE === "phase-production-compile";
	const connectionLimit = resolveConnectionLimit(env.DATABASE_POOL_SIZE);
	// Fail fast during SSG so Next can retry/fallback instead of hanging 30s+.
	const connectTimeout = isBuild
		? Math.min(env.DATABASE_CONNECT_TIMEOUT_MS, 5_000)
		: env.DATABASE_CONNECT_TIMEOUT_MS;

	const pool = mysql.createPool({
		host: url.hostname,
		port: Number(url.port) || 3306,
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
		database: url.pathname.replace(/^\//, ""),
		charset: "utf8mb4",
		waitForConnections: true,
		connectionLimit,
		queueLimit: 0,
		connectTimeout,
		idleTimeout: env.DATABASE_IDLE_TIMEOUT_MS,
		enableKeepAlive: true,
		// Allow :placeholder syntax for raw SQL helpers.
		namedPlaceholders: true,
		// Reject multiple statements (SQL injection hardening).
		multipleStatements: false,
		supportBigNumbers: true,
	});

	return drizzle(instrumentDatabase(pool), {
		schema: fullSchema,
		mode: "default",
		logger: false,
	});
}

export const db = globalForDb.db ?? createDb();

if (env.NODE_ENV !== "production") globalForDb.db = db;

export function rowsFrom<T>(result: unknown): T[] {
	const [first] = result as [unknown, unknown];
	return (Array.isArray(first) ? first : []) as T[];
}

export async function queryRows<T>(query: SQL | string): Promise<T[]> {
	return rowsFrom<T>(await db.execute(query));
}

export async function execResult(
	query: SQL | string,
): Promise<ResultSetHeader> {
	const [first] = (await db.execute(query)) as unknown as [unknown, unknown];
	return first as ResultSetHeader;
}

export async function affectedRows(query: SQL | string): Promise<number> {
	return (await execResult(query)).affectedRows;
}

export type Db = ReturnType<typeof createDb>;

export * from "@/db/schema";
