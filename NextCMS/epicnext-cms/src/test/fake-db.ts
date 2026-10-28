import type { SQL } from "drizzle-orm";

/**
 * Test helper for mocking the Drizzle query builder without a database.
 *
 * Usage inside a `vi.mock("@/lib/db", ...)` factory:
 *
 * ```ts
 * vi.mock("@/lib/db", async () => {
 *   const schema = await import("@/db/schema");
 *   const { createFakeDb } = await import("@/test/fake-db");
 *   return {
 *     ...schema,
 *     db: createFakeDb((table) => (table === schema.User ? users : [])),
 *   };
 * });
 * ```
 *
 * `resolve` receives the table object passed to `.from(...)` and the select
 * projection (so callers can detect `count()` queries via a `total` key).
 */
export type FakeDbResolver = (
	table: unknown,
	projection: Record<string, unknown>,
) => unknown[] | Promise<unknown[]>;

function makeQuery(
	table: unknown,
	projection: Record<string, unknown>,
	resolve: FakeDbResolver,
) {
	const query: Record<string, unknown> = {};
	const self = () => query;
	for (const method of [
		"where",
		"orderBy",
		"limit",
		"offset",
		"leftJoin",
		"innerJoin",
		"groupBy",
		"having",
		"for",
	]) {
		query[method] = self;
	}
	// biome-ignore lint/suspicious/noThenProperty: intentional thenable for await support
	query.then = (
		onFulfilled: (value: unknown) => unknown,
		onRejected: (error: unknown) => unknown,
	) =>
		Promise.resolve(resolve(table, projection)).then(onFulfilled, onRejected);
	query.catch = (onRejected: (error: unknown) => unknown) =>
		Promise.resolve(resolve(table, projection)).catch(onRejected);
	return query;
}

export function createFakeDb(resolve: FakeDbResolver) {
	return {
		select: (projection: Record<string, unknown> = {}) => ({
			from: (table: unknown) => makeQuery(table, projection, resolve),
		}),
		execute: (query: SQL | string) => resolve(query, {}),
	};
}
