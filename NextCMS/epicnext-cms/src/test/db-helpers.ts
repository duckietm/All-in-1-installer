import type { ResultSetHeader } from "mysql2";

export function rowsFrom<T>(result: unknown): T[] {
	const [first] = result as [unknown, unknown];
	return (Array.isArray(first) ? first : []) as T[];
}

export function createDbHelpers<Query>(execute: (query: Query) => unknown) {
	async function queryRows<T>(query: Query): Promise<T[]> {
		return rowsFrom<T>(await execute(query));
	}

	async function execResult(query: Query): Promise<ResultSetHeader> {
		const [first] = (await execute(query)) as [unknown, unknown];
		return first as ResultSetHeader;
	}

	async function affectedRows(query: Query): Promise<number> {
		return (await execResult(query)).affectedRows;
	}

	return { rowsFrom, queryRows, execResult, affectedRows };
}
