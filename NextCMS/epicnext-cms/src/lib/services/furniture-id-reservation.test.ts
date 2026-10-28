// @ts-nocheck
// @vitest-environment node
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), conflict: vi.fn() }));
vi.mock("@/lib/db", async () => ({
	...(await import("@/test/db-helpers")).createDbHelpers(mocks.execute),
	db: { execute: mocks.execute },
}));
vi.mock("./furni-data", () => ({ findFurniDataIdConflict: mocks.conflict }));

import { reserveFurnitureId } from "./furniture-id-reservation";

const dialect = new MySqlDialect();
let occupied: Set<number>;
beforeEach(() => {
	occupied = new Set([16940]);
	mocks.conflict.mockReset().mockResolvedValue(null);
	mocks.execute.mockReset().mockImplementation(async (query) => {
		const { sql, params } = dialect.sqlToQuery(query);
		return sql.includes("MAX(")
			? [[{ maximum: Math.max(...occupied) }], []]
			: [
					occupied.has(Number(params[0]))
						? [{ item_name: "recycler_kintsugi" }]
						: [],
					[],
				];
	});
});
describe("furniture ID reservation", () => {
	it("remaps a source ID already owned by another furniture", async () => {
		const insert = vi.fn();
		expect(await reserveFurnitureId(16940, "recycler_kintsugiB", insert)).toBe(
			16941,
		);
		expect(insert).toHaveBeenCalledWith(16941);
	});
	it("checks furnidata-only collisions too", async () => {
		mocks.conflict.mockImplementation(async (id) =>
			id === 16941 ? "other" : null,
		);
		expect(await reserveFurnitureId(16940, "new", vi.fn())).toBe(16942);
	});
	it("reserves distinct IDs for concurrent imports", async () => {
		const insert = async (id: number) => {
			await Promise.resolve();
			occupied.add(id);
		};
		expect(
			await Promise.all([
				reserveFurnitureId(16940, "first", insert),
				reserveFurnitureId(16940, "second", insert),
			]),
		).toEqual([16941, 16942]);
	});
	it("retries competing primary-key inserts without overwriting the owner", async () => {
		const insert = vi
			.fn()
			.mockImplementationOnce(async () => {
				occupied.add(16941);
				throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
			})
			.mockResolvedValue(undefined);
		expect(await reserveFurnitureId(16940, "new", insert)).toBe(16942);
	});
	it("propagates non-collision errors and releases the queue", async () => {
		await expect(
			reserveFurnitureId(16940, "new", async () => {
				throw new Error("DB unavailable");
			}),
		).rejects.toThrow("DB unavailable");
		expect(await reserveFurnitureId(16940, "next", vi.fn())).toBe(16941);
	});
	it("fails safely at the client integer limit", async () => {
		occupied.add(2147483647);
		const insert = vi.fn();
		await expect(reserveFurnitureId(16940, "new", insert)).rejects.toThrow(
			"No valid furniture ID",
		);
		expect(insert).not.toHaveBeenCalled();
	});
});
