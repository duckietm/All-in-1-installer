import { describe, expect, it } from "vitest";
import { PERMS } from "@/lib/permission-slugs";
import { ownedLegacyPages } from "./discover-legacy-pages";
import { hotelMigrationEntries } from "./hotel";
import { validateMigrationEntries } from "./validate-matrix";

const HOTEL_PREFIXES = [
	"/admin/rooms",
	"/admin/navigation",
	"/admin/radio",
	"/admin/studio",
] as const;

describe("hotelMigrationEntries", () => {
	it("maps all hotel tools below the hotel target root", () => {
		expect(
			validateMigrationEntries(
				ownedLegacyPages(HOTEL_PREFIXES),
				hotelMigrationEntries,
			),
		).toEqual([]);
		expect(
			hotelMigrationEntries.every(
				(row) =>
					row.targetPath === null || row.targetPath.startsWith("/admin/hotel/"),
			),
		).toBe(true);
	});

	it("preserves room ids while merging only the detail aliases", () => {
		expect(
			hotelMigrationEntries
				.filter((row) => row.legacyPath.startsWith("/admin/rooms"))
				.map(({ legacyPath, targetPath, decision }) => ({
					legacyPath,
					targetPath,
					decision,
				})),
		).toEqual([
			{
				legacyPath: "/admin/rooms",
				targetPath: "/admin/hotel/rooms",
				decision: "REBUILD",
			},
			{
				legacyPath: "/admin/rooms/:id",
				targetPath: "/admin/hotel/rooms/:id",
				decision: "MERGE",
			},
			{
				legacyPath: "/admin/rooms/:id/furni",
				targetPath: "/admin/hotel/rooms/:id/furni",
				decision: "REBUILD",
			},
			{
				legacyPath: "/admin/rooms/edit/:id",
				targetPath: "/admin/hotel/rooms/:id",
				decision: "MERGE",
			},
			{
				legacyPath: "/admin/rooms/show/:id",
				targetPath: "/admin/hotel/rooms/:id",
				decision: "MERGE",
			},
		]);
	});

	it("keeps every audited workflow planned without parity claims", () => {
		expect(
			hotelMigrationEntries.every(
				(row) => row.status === "PLANNED" && row.parityEvidence.length === 0,
			),
		).toBe(true);
	});

	it("requires privileged audit and an explicit capability for every mutation", () => {
		const mutationRows = hotelMigrationEntries.filter(
			(row) => row.dependencies.mutations.length > 0,
		);

		expect(mutationRows.length).toBeGreaterThan(0);
		expect(
			mutationRows.every(
				(row) =>
					row.capabilities.mutate.length > 0 &&
					row.auditRequirement === "PRIVILEGED_MUTATION",
			),
		).toBe(true);
	});

	it("classifies Studio Audit repair operations as privileged mutations", () => {
		const studioAudit = hotelMigrationEntries.find(
			(row) => row.legacyPath === "/admin/studio/audit",
		);

		expect(studioAudit).toEqual(
			expect.objectContaining({
				capabilities: {
					read: [PERMS.ASSETS_IMPORT],
					mutate: [PERMS.ASSETS_IMPORT],
				},
				dependencies: expect.objectContaining({
					mutations: expect.arrayContaining([
						"POST /cms_api/admin/import/audit",
						"applyCatalogSql",
						"ensureDirectories",
						"repairDuplicateClassnames",
						"repairFurniData",
						"repairMissingIcons",
						"repairMissingNitros",
						"repairOrphanedCatalog",
					]),
				}),
				auditRequirement: "PRIVILEGED_MUTATION",
			}),
		);
	});

	it("records the actual permissions for room, radio, and Studio mutations", () => {
		expect(hotelMigrationEntries).toContainEqual(
			expect.objectContaining({
				legacyPath: "/admin/rooms/edit/:id",
				capabilities: {
					read: [PERMS.ROOMS_EDIT],
					mutate: [PERMS.ROOMS_EDIT, PERMS.ROOMS_DELETE],
				},
			}),
		);
		expect(hotelMigrationEntries).toContainEqual(
			expect.objectContaining({
				legacyPath: "/admin/radio/api-keys",
				capabilities: {
					read: [PERMS.RADIO_VIEW],
					mutate: [PERMS.RADIO_EDIT],
				},
			}),
		);
		expect(hotelMigrationEntries).toContainEqual(
			expect.objectContaining({
				legacyPath: "/admin/studio/sync",
				capabilities: {
					read: [PERMS.ASSETS_IMPORT],
					mutate: [PERMS.ASSETS_IMPORT],
				},
			}),
		);
	});
});
