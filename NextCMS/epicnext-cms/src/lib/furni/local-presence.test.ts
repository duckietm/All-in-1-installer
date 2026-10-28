import { describe, expect, it } from "vitest";
import { indexLocalFurniture, localFurnitureStatus } from "./local-presence";

const index = indexLocalFurniture([
	{ id: 2000037258, itemName: "recycler_kintsugib" },
]);
describe("local furniture recognition", () => {
	it("recognizes casing differences and uses the allocated catalog ID", () => {
		expect(
			localFurnitureStatus(
				"recycler_kintsugiB",
				index,
				new Set(["recycler_kintsugib"]),
				new Set([2000037258]),
			),
		).toEqual({
			alreadyImported: true,
			localId: 2000037258,
			hasFurnidata: true,
			hasCatalogEntry: true,
		});
	});
	it("does not confuse the base furniture with its named variant", () => {
		expect(
			localFurnitureStatus(
				"recycler_kintsugi",
				index,
				new Set(),
				new Set([16940]),
			).alreadyImported,
		).toBe(false);
	});
	it("does not identify a source-ID collision as a matching catalog offer", () => {
		expect(
			localFurnitureStatus(
				"recycler_kintsugiB",
				index,
				new Set(),
				new Set([16940]),
			).hasCatalogEntry,
		).toBe(false);
	});
	it("retains separate color variants and duplicate SQL records", () => {
		const rows = indexLocalFurniture([
			{ id: 1, itemName: "chair*0" },
			{ id: 2, itemName: "CHAIR*0" },
			{ id: 3, itemName: "chair*1" },
		]);
		expect(rows.get("chair*0")).toHaveLength(2);
		expect(rows.get("chair*1")).toHaveLength(1);
		expect(
			localFurnitureStatus("chair*0", rows, new Set(), new Set()).localId,
		).toBeUndefined();
	});
});
