import type { SQL } from "drizzle-orm";

/**
 * Test helper: a Drizzle-shaped fake DB that records every statement and can
 * throw per kind, so server-action unit tests can assert on the exact
 * insert/update/delete calls the action performs.
 *
 * Every call is appended to `config.ops`. `insert().values()` is awaitable and
 * also exposes `onDuplicateKeyUpdate({ set })` (upsert), matching the shapes
 * the CMS actions use.
 */
export type FakeDbOp =
	| {
			kind: "insert";
			table: unknown;
			values: Record<string, unknown>;
			onDuplicate?: Record<string, unknown>;
	  }
	| {
			kind: "update";
			table: unknown;
			set: Record<string, unknown>;
			where?: unknown;
	  }
	| { kind: "delete"; table: unknown; where?: unknown }
	| { kind: "select"; table: unknown; projection: Record<string, unknown> }
	| { kind: "execute"; query: unknown };

export interface FakeActionDbConfig {
	ops: FakeDbOp[];
	insertResult?: unknown;
	updateResult?: unknown;
	deleteResult?: unknown;
	selectResult?: unknown;
	executeResult?: unknown;
	/** Return a truthy value (optionally a message string) to make this kind fail. */
	fail?: (kind: FakeDbOp["kind"], op: FakeDbOp) => unknown;
}

export function createFakeActionDb(config: FakeActionDbConfig) {
	const resultOf = (kind: FakeDbOp["kind"]) => {
		switch (kind) {
			case "insert":
				return config.insertResult ?? [{ insertId: 1 }];
			case "update":
				return config.updateResult ?? [];
			case "delete":
				return config.deleteResult ?? [];
			case "select":
				return config.selectResult ?? [];
			case "execute":
				return config.executeResult ?? [];
		}
	};

	const run = (kind: FakeDbOp["kind"], op: FakeDbOp): Promise<unknown> => {
		const outcome = config.fail ? config.fail(kind, op) : undefined;
		if (outcome) {
			const msg = typeof outcome === "string" ? outcome : `fake ${kind} failed`;
			return Promise.reject(new Error(msg));
		}
		return Promise.resolve(resultOf(kind));
	};

	const insert = (table: unknown) => ({
		values: (values: Record<string, unknown>) => {
			const op: FakeDbOp = { kind: "insert", table, values };
			config.ops.push(op);
			const execute = () => run("insert", op);
			return {
				// biome-ignore lint/suspicious/noThenProperty: intentional thenable for await support
				then: (
					onFulfilled: (value: unknown) => unknown,
					onRejected: (error: unknown) => unknown,
				) => execute().then(onFulfilled, onRejected),
				catch: (onRejected: (error: unknown) => unknown) =>
					execute().catch(onRejected),
				onDuplicateKeyUpdate: (dup: { set: Record<string, unknown> }) => {
					op.onDuplicate = dup.set;
					return run("insert", op);
				},
			};
		},
	});

	const update = (table: unknown) => ({
		set: (set: Record<string, unknown>) => ({
			where: (cond: unknown) => {
				const op: FakeDbOp = { kind: "update", table, set, where: cond };
				config.ops.push(op);
				return run("update", op);
			},
		}),
	});

	const del = (table: unknown) => ({
		where: (cond: unknown) => {
			const op: FakeDbOp = { kind: "delete", table, where: cond };
			config.ops.push(op);
			return run("delete", op);
		},
	});

	const makeQuery = (table: unknown, projection: Record<string, unknown>) => {
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
		const selectOp = (): FakeDbOp => ({ kind: "select", table, projection });
		// biome-ignore lint/suspicious/noThenProperty: intentional thenable for await support
		query.then = (
			onFulfilled: (value: unknown) => unknown,
			onRejected: (error: unknown) => unknown,
		) => run("select", selectOp()).then(onFulfilled, onRejected);
		query.catch = (onRejected: (error: unknown) => unknown) =>
			run("select", selectOp()).catch(onRejected);
		return query;
	};

	return {
		insert,
		update,
		delete: del,
		select: (projection: Record<string, unknown> = {}) => ({
			from: (table: unknown) => makeQuery(table, projection),
		}),
		execute: (sql: SQL | string) => {
			const op: FakeDbOp = { kind: "execute", query: sql };
			config.ops.push(op);
			return run("execute", op);
		},
	};
}

export function insertOps(dbOps: FakeDbOp[]): FakeDbOp[] {
	return dbOps.filter((op) => op.kind === "insert");
}

export function updateOps(dbOps: FakeDbOp[]): FakeDbOp[] {
	return dbOps.filter((op) => op.kind === "update");
}

export function deleteOps(dbOps: FakeDbOp[]): FakeDbOp[] {
	return dbOps.filter((op) => op.kind === "delete");
}
