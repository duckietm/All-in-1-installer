// @ts-nocheck
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({
	rowsFrom: (await import("@/test/db-helpers")).rowsFrom,
	db: {},
}));

import { applyHistory, type HistoryTransaction } from "./server";

it("locks original and current categories before restoring offer prices and category", async () => {
	const before = { pageId: "4", costCredits: 10, costPoints: 0, pointsType: 0 };
	const after = { ...before, pageId: "9", costCredits: 20 };
	let current = after;
	const queries: string[] = [];
	const tx = {
		execute: async (query: SQL) => {
			const text = new MySqlDialect().sqlToQuery(query).sql;
			queries.push(text);
			if (text.includes("catalog_pages")) return [[{ id: 4 }, { id: 9 }]];
			if (text.startsWith("SELECT")) return [[current]];
			current = before;
			return [{}];
		},
		insert: () => ({ values: async () => [{ insertId: 17 }] }),
	} as unknown as HistoryTransaction;
	await applyHistory(
		tx,
		{ kind: "catalog_offer", targetId: 1, before, after },
		7,
	);
	expect(queries[0]).toContain("catalog_pages");
	expect(queries[0]).toContain("FOR UPDATE");
	expect(queries.find((q) => q.startsWith("UPDATE"))).toContain("page_id");
	await expect(
		applyHistory(tx, { kind: "catalog_offer", targetId: 1, before, after }, 7),
	).rejects.toThrow("conflict");
});
it("refuses restoration into deleted categories without writing", async () => {
	const execute = vi.fn(async () => [[]]);
	const tx = { execute } as unknown as HistoryTransaction;
	const values = { pageId: "4", costCredits: 10, costPoints: 0, pointsType: 0 };
	await expect(
		applyHistory(
			tx,
			{
				kind: "catalog_offer",
				targetId: 1,
				before: values,
				after: { ...values, pageId: "9" },
			},
			7,
		),
	).rejects.toThrow("unavailable");
	expect(execute).toHaveBeenCalledTimes(1);
});
