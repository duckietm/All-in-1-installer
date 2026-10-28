import { describe, expect, it } from "vitest";
import { discoverLegacyPages } from "./discover-legacy-pages";
import { HOUSEKEEPING_MIGRATION_MATRIX } from "./matrix";
import { validateMigrationEntries } from "./validate-matrix";

describe("HOUSEKEEPING_MIGRATION_MATRIX", () => {
	it("covers all 147 legacy pages exactly once", () => {
		const discovered = discoverLegacyPages();

		expect(HOUSEKEEPING_MIGRATION_MATRIX).toHaveLength(147);
		expect(
			validateMigrationEntries(discovered, HOUSEKEEPING_MIGRATION_MATRIX),
		).toEqual([]);
	});

	it("contains no undecided evidence markers", () => {
		expect(JSON.stringify(HOUSEKEEPING_MIGRATION_MATRIX)).not.toMatch(
			/TBD|TODO|FIXME|UNCLASSIFIED/,
		);
	});

	it("is sorted by legacy path", () => {
		expect(HOUSEKEEPING_MIGRATION_MATRIX.map((row) => row.legacyPath)).toEqual(
			[...HOUSEKEEPING_MIGRATION_MATRIX.map((row) => row.legacyPath)].sort(
				(a, b) => a.localeCompare(b),
			),
		);
	});
});
