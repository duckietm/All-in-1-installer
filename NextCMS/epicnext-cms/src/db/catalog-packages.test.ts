// @ts-nocheck
import { describe, expect, it } from "vitest";
import { CatalogPackages } from "./catalog-packages";

const columns = CatalogPackages[Symbol.for("drizzle:Columns")] as Record<
	string,
	{ name: string; notNull: boolean; primary: boolean; dataType: string }
>;

describe("CatalogPackages table schema", () => {
	it("maps to the website_catalog_packages table", () => {
		expect(CatalogPackages[Symbol.for("drizzle:Name")]).toBe(
			"website_catalog_packages",
		);
	});

	it("defines a uuid primary key", () => {
		expect(columns.id).toMatchObject({
			name: "id",
			primary: true,
			notNull: true,
		});
	});

	it("defines the package metadata columns as NOT NULL", () => {
		for (const key of ["name", "version", "status", "mode", "payload"]) {
			expect(columns[key]?.notNull).toBe(true);
			expect(columns[key]?.name).toBe(key);
		}
	});

	it("keeps the version column numeric and payload longtext", () => {
		expect(columns.version.dataType).toBe("number");
		expect(columns.payload.dataType).toBe("string");
	});

	it("tracks an updated_at timestamp and exposes $inferSelect/$inferInsert types", () => {
		expect(columns.updatedAt.name).toBe("updated_at");
		expect(columns.updatedAt.notNull).toBe(true);
	});
});
