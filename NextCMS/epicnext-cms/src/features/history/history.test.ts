// @ts-nocheck
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({
	...(await import("@/db/schema")),
	rowsFrom: (await import("@/test/db-helpers")).rowsFrom,
	db: {},
}));

import { historyChanges, sameSnapshot } from "./model";
import {
	applyHistory,
	type HistoryTransaction,
	historySnapshot,
} from "./server";

describe("history restore safety", () => {
	const before = { costCredits: 10, costPoints: 0, pointsType: 0 };
	const after = { costCredits: 20, costPoints: 0, pointsType: 0 };
	function transaction(current = after) {
		const writes: string[] = [];
		const audit = vi.fn();
		let snapshot = current;
		const tx = {
			execute: vi.fn(async (query: SQL) => {
				const text = new MySqlDialect().sqlToQuery(query).sql;
				if (text.startsWith("SELECT")) return [[snapshot]];
				writes.push(text);
				snapshot = before;
				return [{}];
			}),
			insert: () => ({ values: audit }),
		} as unknown as HistoryTransaction;
		return { tx, writes, audit };
	}
	it("compares all recorded fields and does not confuse null with empty", () => {
		expect(sameSnapshot({ a: null }, { a: "" })).toBe(false);
		expect(sameSnapshot(after, { ...after, extra: 0 })).toBe(false);
		expect(historyChanges(after, before)).toEqual([
			{ key: "costCredits", current: 20, restore: 10 },
		]);
	});
	it("rejects concurrent edits without any writes or audit", async () => {
		const { tx, writes, audit } = transaction({ ...after, costPoints: 5 });
		await expect(
			applyHistory(tx, { kind: "prices", targetId: 1, before, after }, 7),
		).rejects.toThrow("conflict");
		expect(writes).toEqual([]);
		expect(audit).not.toHaveBeenCalled();
	});
	it("restores only the price fields and audits in the same transaction", async () => {
		const { tx, writes, audit } = transaction();
		await applyHistory(tx, { kind: "prices", targetId: 1, before, after }, 7);
		expect(writes).toHaveLength(1);
		expect(writes[0]).not.toContain("limited_sells");
		expect(audit).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 7,
				action: "history_restore",
				before: JSON.stringify(after),
				after: JSON.stringify(before),
			}),
		);
	});
	it("propagates audit failure so the caller transaction rolls back", async () => {
		const { tx, audit } = transaction();
		audit.mockRejectedValue(Error("audit unavailable"));
		await expect(
			applyHistory(tx, { kind: "prices", targetId: 1, before, after }, 7),
		).rejects.toThrow("audit unavailable");
	});
	it("rejects a second restore of the same revision", async () => {
		const { tx, writes, audit } = transaction();
		const entry = { kind: "prices" as const, targetId: 1, before, after };
		await applyHistory(tx, entry, 7);
		await expect(applyHistory(tx, entry, 7)).rejects.toThrow("conflict");
		expect(writes).toHaveLength(1);
		expect(audit).toHaveBeenCalledTimes(1);
	});
	it("reads only columns present in the smaller builder club schema", async () => {
		const { tx } = transaction();
		const snapshot = await historySnapshot(tx, "category_bc", 1);
		expect(snapshot).not.toHaveProperty("captionSave");
		expect(snapshot).not.toHaveProperty("includes");
		expect(snapshot).toHaveProperty("caption");
	});
});
