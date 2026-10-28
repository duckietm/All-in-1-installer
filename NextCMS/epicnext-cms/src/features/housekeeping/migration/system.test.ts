import { describe, expect, it } from "vitest";
import { PERMS } from "@/lib/permission-slugs";
import { ownedLegacyPages } from "./discover-legacy-pages";
import { systemMigrationEntries } from "./system";
import { validateMigrationEntries } from "./validate-matrix";

const SYSTEM_PREFIXES = [
	"/admin/alerts",
	"/admin/analytics",
	"/admin/commandocentrum",
	"/admin/devops",
	"/admin/emulator",
	"/admin/housekeeping",
	"/admin/logs",
	"/admin/maintenance",
	"/admin/permissions",
	"/admin/settings",
] as const;

describe("systemMigrationEntries", () => {
	it("covers all 24 System pages exactly once", () => {
		expect(systemMigrationEntries).toHaveLength(24);
		expect(
			validateMigrationEntries(
				ownedLegacyPages(SYSTEM_PREFIXES),
				systemMigrationEntries,
			),
		).toEqual([]);
	});

	it("removes legacy foundation-owned pages", () => {
		expect(systemMigrationEntries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					legacyPath: "/admin/housekeeping",
					decision: "REMOVE",
					targetPath: null,
				}),
			]),
		);
	});

	it("keeps live permissions as a System workflow", () => {
		expect(systemMigrationEntries).toContainEqual(
			expect.objectContaining({
				legacyPath: "/admin/permissions",
				targetPath: "/admin/system/access/permissions",
				decision: expect.not.stringMatching("REMOVE"),
			}),
		);
	});

	it("retains the read-only legacy housekeeping value in removal notes", () => {
		const housekeeping = systemMigrationEntries.find(
			(row) => row.legacyPath === "/admin/housekeeping",
		);

		expect(housekeeping?.dependencies.queries).toEqual(
			expect.arrayContaining([
				"exportPermissions",
				"getAuditLogs",
				"legacy ACL comparison",
			]),
		);
		expect(housekeeping?.notes.join(" ")).toMatch(
			/read-only.*export.*comparison/i,
		);
	});

	it("uses only the approved System target roots", () => {
		const allowedRoots = [
			"/admin/system/access",
			"/admin/system/configuration",
			"/admin/system/observability",
			"/admin/system/operations",
		];

		expect(
			systemMigrationEntries.every(
				(row) =>
					row.targetPath === null ||
					allowedRoots.some(
						(root) =>
							row.targetPath === root || row.targetPath?.startsWith(`${root}/`),
					),
			),
		).toBe(true);
	});

	it("keeps non-removal workflows planned without parity claims", () => {
		expect(
			systemMigrationEntries
				.filter((row) => row.decision !== "REMOVE")
				.every(
					(row) => row.status === "PLANNED" && row.parityEvidence.length === 0,
				),
		).toBe(true);
	});

	it("records authoritative capabilities for privileged System mutations", () => {
		expect(systemMigrationEntries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					legacyPath: "/admin/commandocentrum",
					capabilities: {
						read: [PERMS.RCON_EXECUTE],
						mutate: [PERMS.RCON_EXECUTE],
					},
					auditRequirement: "PRIVILEGED_MUTATION",
				}),
				expect.objectContaining({
					legacyPath: "/admin/permissions/:id",
					capabilities: {
						read: [PERMS.PERMISSIONS_MANAGE],
						mutate: [PERMS.PERMISSIONS_MANAGE],
					},
					auditRequirement: "PRIVILEGED_MUTATION",
				}),
			]),
		);
	});
});
