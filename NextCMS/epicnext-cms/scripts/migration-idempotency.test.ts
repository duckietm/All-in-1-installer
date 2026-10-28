import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("radio columns migration", () => {
	it("adds every column idempotently for partially migrated databases", () => {
		const sql = readFileSync(
			resolve("drizzle/migrations/0009_radio_contests_giveaways_columns.sql"),
			"utf8",
		);
		const additions = sql.match(/ADD COLUMN(?! IF NOT EXISTS)/gi) ?? [];
		expect(additions).toEqual([]);
		expect(sql).toContain("ADD COLUMN IF NOT EXISTS `title`");
	});
});
