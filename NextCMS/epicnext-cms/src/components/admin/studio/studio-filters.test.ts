import { describe, expect, it } from "vitest";
import { filterFurniture } from "./studio-filters";
import type { FurniItem } from "./studio-types";

function item(over: Partial<FurniItem> & { classname: string }): FurniItem {
	return {
		id: 1,
		type: "flooritem",
		name: "Chair",
		description: "",
		revision: 1,
		category: "chairs",
		alreadyImported: true,
		nitroExists: true,
		hasFurnidata: true,
		hasCatalogEntry: true,
		...over,
	};
}

const all = { typeFilter: "all", categoryFilter: "all", sortBy: "default" };
const withStatus = (statusFilter: string) => ({ ...all, statusFilter });

describe("filterFurniture", () => {
	it("keeps only imported items whose classname is absent from furnidata", () => {
		const items = [
			item({ classname: "missing", hasFurnidata: false }),
			item({ classname: "present" }),
			// An item that is not imported yet has no furnidata entry, but the
			// "Missing furnidata" filter is about imported items only.
			item({ classname: "new", alreadyImported: false, hasFurnidata: false }),
			// hasFurnidata is optional; undefined means "not checked", not missing.
			item({ classname: "unknown", hasFurnidata: undefined }),
		];

		expect(
			filterFurniture(items, withStatus("missingFurnidata")).map(
				(i) => i.classname,
			),
		).toEqual(["missing"]);
	});

	it("does not treat an unchecked item as missing", () => {
		const items = [item({ classname: "unknown", hasFurnidata: undefined })];
		expect(filterFurniture(items, withStatus("missingFurnidata"))).toEqual([]);
	});

	it("keeps the other status filters independent of furnidata", () => {
		const items = [
			item({ classname: "ok" }),
			item({ classname: "noNitro", nitroExists: false, hasFurnidata: false }),
			item({ classname: "noCatalog", hasCatalogEntry: false }),
			item({ classname: "new", alreadyImported: false }),
		];

		expect(
			filterFurniture(items, withStatus("missingNitro")).map(
				(i) => i.classname,
			),
		).toEqual(["noNitro"]);
		expect(
			filterFurniture(items, withStatus("missingCatalog")).map(
				(i) => i.classname,
			),
		).toEqual(["noCatalog"]);
		expect(
			filterFurniture(items, withStatus("notImported")).map((i) => i.classname),
		).toEqual(["new"]);
	});
});
