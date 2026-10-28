// @ts-nocheck
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execute: vi.fn(),
	transaction: vi.fn(),
	insert: vi.fn(),
	values: vi.fn(),
}));
vi.mock("@/lib/db", async () => ({
	...(await import("@/test/db-helpers")).createDbHelpers(mocks.execute),
	AdminAuditLog: "audit",
	db: { execute: mocks.execute, transaction: mocks.transaction },
}));
vi.mock("@/lib/services/furni-data", () => ({}));
vi.mock("@/lib/services/furni-import", () => ({}));

import {
	applyCatalogParentRepair,
	previewCatalogParentRepair,
} from "./catalog-repair";

const dialect = new MySqlDialect();
let pages: { id: number; parentId: number; caption: string }[];
beforeEach(() => {
	vi.clearAllMocks();
	pages = [
		{ id: 1, parentId: 999, caption: "Orphan" },
		{ id: 2, parentId: -1, caption: "Root" },
	];
	mocks.execute.mockImplementation(async (query) =>
		dialect.sqlToQuery(query).sql.startsWith("SELECT")
			? [pages, []]
			: [{ affectedRows: 1 }, []],
	);
	mocks.insert.mockReturnValue({ values: mocks.values });
	mocks.values.mockResolvedValue(undefined);
	mocks.transaction.mockImplementation((callback) =>
		callback({ execute: mocks.execute, insert: mocks.insert }),
	);
});
describe("catalog parent repair", () => {
	it("previews without writes, locks the graph and records each change inside the transaction", async () => {
		const preview = await previewCatalogParentRepair("normal");
		expect(preview.changes).toEqual([
			{ id: 1, caption: "Orphan", from: 999, to: -1 },
		]);
		expect(mocks.transaction).not.toHaveBeenCalled();
		expect(
			await applyCatalogParentRepair("normal", preview.fingerprint, 7),
		).toEqual({ applied: 1 });
		const queries = mocks.execute.mock.calls.map(([query]) =>
			dialect.sqlToQuery(query),
		);
		expect(queries[1].sql).toContain("FOR UPDATE");
		expect(queries[2].sql).toContain("UPDATE catalog_pages SET parent_id");
		expect(queries[2].params).toEqual([-1, 1, 999]);
		expect(queries.some((query) => /DELETE|INSERT/.test(query.sql))).toBe(
			false,
		);
		expect(mocks.values).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 7,
				targetId: 1,
				action: "catalog_parent_repair",
			}),
		);
	});
	it("rejects a stale preview before any mutation when the graph changed", async () => {
		const preview = await previewCatalogParentRepair("normal");
		pages = [...pages, { id: 999, parentId: -1, caption: "Restored" }];
		await expect(
			applyCatalogParentRepair("normal", preview.fingerprint, 7),
		).rejects.toMatchObject({ name: "CatalogPreviewConflict" });
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.execute).toHaveBeenCalledTimes(2);
	});
	it("binds previews to the selected catalog and uses BC tables for BC repairs", async () => {
		const preview = await previewCatalogParentRepair("bc");
		await expect(
			applyCatalogParentRepair("normal", preview.fingerprint, 7),
		).rejects.toMatchObject({ name: "CatalogPreviewConflict" });
		await applyCatalogParentRepair("bc", preview.fingerprint, 7);
		expect(
			dialect.sqlToQuery(mocks.execute.mock.calls.at(-1)?.[0]).sql,
		).toContain("UPDATE catalog_pages_bc");
	});
	it("propagates audit failure so the transaction rolls back, instead of claiming success", async () => {
		const preview = await previewCatalogParentRepair("normal");
		mocks.values.mockRejectedValue(new Error("Audit unavailable"));
		await expect(
			applyCatalogParentRepair("normal", preview.fingerprint, 7),
		).rejects.toThrow("Audit unavailable");
	});
});
