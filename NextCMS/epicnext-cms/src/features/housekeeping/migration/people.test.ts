import { describe, expect, it } from "vitest";
import { discoverLegacyPages } from "./discover-legacy-pages";
import { operationsMigrationEntries } from "./operations";
import { peopleMigrationEntries } from "./people";
import { validateMigrationEntries } from "./validate-matrix";

const PEOPLE_PREFIXES = [
	"/admin/users",
	"/admin/online",
	"/admin/guilds",
	"/admin/applications",
	"/admin/teams",
	"/admin/bans",
	"/admin/ip",
	"/admin/vpn",
	"/admin/wordfilter",
	"/admin/moderation",
	"/admin/tickets",
	"/admin/help-tickets",
	"/mod",
] as const;

describe("peopleMigrationEntries", () => {
	it("merges every mod page into a people workflow", () => {
		const modRows = peopleMigrationEntries.filter(
			(row) => row.surface === "mod",
		);

		expect(modRows).toHaveLength(13);
		expect(modRows.every((row) => row.decision === "MERGE")).toBe(true);
		expect(
			modRows.every((row) => row.targetPath?.startsWith("/admin/people/")),
		).toBe(true);
	});

	it("merges duplicate user detail and edit aliases", () => {
		for (const legacyPath of ["/admin/users/:id", "/admin/users/:id/edit"]) {
			expect(peopleMigrationEntries).toContainEqual(
				expect.objectContaining({ legacyPath, decision: "MERGE" }),
			);
		}
	});

	it("keeps planned rows free of unverified parity claims", () => {
		expect(
			peopleMigrationEntries.every(
				(row) => row.status === "PLANNED" && row.parityEvidence.length === 0,
			),
		).toBe(true);
	});

	it("covers every Operations and People legacy page exactly once", () => {
		const expected = discoverLegacyPages().filter(
			(page) =>
				page.legacyPath === "/admin" ||
				page.legacyPath === "/admin/operations" ||
				PEOPLE_PREFIXES.some(
					(prefix) =>
						page.legacyPath === prefix ||
						page.legacyPath.startsWith(`${prefix}/`),
				),
		);

		expect(
			validateMigrationEntries(expected, [
				...operationsMigrationEntries,
				...peopleMigrationEntries,
			]),
		).toEqual([]);
	});
});
