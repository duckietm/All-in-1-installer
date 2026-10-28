import { describe, expect, it } from "vitest";
import { splitSqlStatements } from "./sql-statements";

describe("splitSqlStatements", () => {
	it("ignores semicolons inside line comments", () => {
		const sql = [
			"-- Existing installs have this; new installs need it.",
			"ALTER TABLE users ADD COLUMN IF NOT EXISTS example TEXT NULL;",
			"-- next statement",
			"CREATE TABLE IF NOT EXISTS example_table (id INT PRIMARY KEY);",
		].join("\n");

		expect(splitSqlStatements(sql)).toEqual([
			"ALTER TABLE users ADD COLUMN IF NOT EXISTS example TEXT NULL",
			"CREATE TABLE IF NOT EXISTS example_table (id INT PRIMARY KEY)",
		]);
	});
});
