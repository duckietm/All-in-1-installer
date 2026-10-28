import { describe, expect, it } from "vitest";
import { ownedLegacyPages } from "./discover-legacy-pages";
import { economyMigrationEntries } from "./economy";
import { validateMigrationEntries } from "./validate-matrix";

const ECONOMY_PREFIXES = [
	"/admin/catalog",
	"/admin/items",
	"/admin/shop",
	"/admin/marketplace",
	"/admin/transactions",
	"/admin/vouchers",
	"/admin/subscriptions",
	"/admin/rare-values",
	"/admin/badges",
	"/admin/achievements",
	"/admin/sounds",
	"/admin/calendar",
	"/admin/referrals",
	"/admin/daily-rewards",
] as const;

describe("economyMigrationEntries", () => {
	it("covers every economy page without legacy-domain targets", () => {
		const expected = ownedLegacyPages(ECONOMY_PREFIXES);
		expect(validateMigrationEntries(expected, economyMigrationEntries)).toEqual(
			[],
		);
		expect(
			economyMigrationEntries.every(
				(row) =>
					row.targetPath === null ||
					row.targetPath.startsWith("/admin/economy/"),
			),
		).toBe(true);
	});

	it("keeps every audited workflow planned without parity claims", () => {
		expect(
			economyMigrationEntries.every(
				(row) => row.status === "PLANNED" && row.parityEvidence.length === 0,
			),
		).toBe(true);
	});

	it("requires privileged audit for economy mutations", () => {
		const mutationRows = economyMigrationEntries.filter(
			(row) => row.dependencies.mutations.length > 0,
		);
		expect(mutationRows.length).toBeGreaterThan(0);
		expect(
			mutationRows.every(
				(row) => row.auditRequirement === "PRIVILEGED_MUTATION",
			),
		).toBe(true);
	});

	it("records the catalog search dependency on base items", () => {
		const catalog = economyMigrationEntries.find(
			(row) => row.legacyPath === "/admin/catalog",
		);

		expect(catalog?.dependencies.queries).toContain("ItemsBase");
	});

	it("marks the item collection localization as partial", () => {
		const items = economyMigrationEntries.find(
			(row) => row.legacyPath === "/admin/items",
		);

		expect(items?.localization).toBe("PARTIAL");
	});
});
