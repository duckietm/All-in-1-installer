// @ts-nocheck
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execute: vi.fn(),
	readdir: vi.fn(),
	ensureDirectories: vi.fn(),
	repair: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ readdir: mocks.readdir }));
vi.mock("@/lib/db", async () => ({
	...(await import("@/test/db-helpers")).createDbHelpers(mocks.execute),
	db: { execute: mocks.execute },
}));
vi.mock("@/lib/services/clone-import", () => ({}));
vi.mock("@/lib/services/clone-sources", () => ({}));
vi.mock("@/lib/services/furni-asset-dirs", () => ({
	getFurniAssetDirs: async () => ({ iconDir: "/icons" }),
}));
vi.mock("@/lib/utils/runtime-path", () => ({}));
vi.mock("./catalog-repair", () => ({}));
vi.mock("./furni-data", () => ({}));
vi.mock("./furni-import", () => ({
	ensureDirectories: mocks.ensureDirectories,
}));
vi.mock("./repair-icons", () => ({ repairMissingIcons: mocks.repair }));
vi.mock("./repair-nitros", () => ({}));

import { inspectLiveCatalogIntegrity } from "./catalog-audit";

const dialect = new MySqlDialect();
beforeEach(() => {
	vi.clearAllMocks();
	mocks.readdir.mockResolvedValue([]);
	mocks.execute.mockImplementation(async (query) => {
		const text = dialect.sqlToQuery(query).sql;
		if (text.includes("FROM items_base"))
			return [
				[{ id: 1, item_name: "chair", public_name: "Chair", type: "s" }],
				[],
			];
		if (text.includes("FROM catalog_pages"))
			return [[{ id: 1, parentId: -1, caption: "Root" }], []];
		return [
			[{ id: 8, pageId: "1", itemIds: "1", name: "Chair", offerId: null }],
			[],
		];
	});
});
describe("read-only integrity audit", () => {
	it("uses BC-specific pages and offers and never invokes directory creation or repair", async () => {
		const result = await inspectLiveCatalogIntegrity("bc");
		const queries = mocks.execute.mock.calls.map(
			([query]) => dialect.sqlToQuery(query).sql,
		);
		expect(queries.every((query) => query.startsWith("SELECT"))).toBe(true);
		expect(queries[0]).toContain("FROM catalog_pages_bc");
		expect(queries[2]).toContain("NULL AS offerId FROM catalog_items_bc");
		expect(result.counts.missing_icon).toBe(1);
		expect(result.counts.missing_page).toBeUndefined();
		expect(mocks.ensureDirectories).not.toHaveBeenCalled();
		expect(mocks.repair).not.toHaveBeenCalled();
	});
	it("distinguishes unavailable icon storage from confirmed missing files", async () => {
		mocks.readdir.mockRejectedValue(new Error("permission denied"));
		const result = await inspectLiveCatalogIntegrity("normal");
		expect(result.iconsAvailable).toBe(false);
		expect(result.counts.missing_icon).toBeUndefined();
	});
	it("does not turn a database failure into a healthy report", async () => {
		mocks.execute.mockRejectedValue(new Error("database unavailable"));
		await expect(inspectLiveCatalogIntegrity("normal")).rejects.toThrow(
			"database unavailable",
		);
	});
});
