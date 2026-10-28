import { describe, expect, it } from "vitest";
import type { LegacyPage, MigrationEntry } from "./types";
import { validateMigrationEntries } from "./validate-matrix";

const page = (legacyPath: string): LegacyPage => ({
	surface: legacyPath.startsWith("/mod") ? "mod" : "admin",
	legacyPath,
	sourceFile: `src/app${legacyPath}/page.tsx`,
});

const entry = (legacyPath: string): MigrationEntry => ({
	...page(legacyPath),
	targetDomain: "system",
	targetPath: "/admin/system/example",
	decision: "REHOST",
	capabilities: { read: ["admin.dashboard"], mutate: [] },
	dependencies: { queries: [], mutations: [] },
	auditRequirement: "NONE",
	localization: "COMPLETE",
	accessibility: "COMPLETE",
	requiredTests: ["unit"],
	parityEvidence: [],
	status: "PLANNED",
	notes: [],
});

describe("validateMigrationEntries", () => {
	it("reports missing, duplicate, and unknown legacy rows", () => {
		const discovered = [page("/admin"), page("/admin/users")];

		expect(
			validateMigrationEntries(discovered, [
				entry("/admin"),
				entry("/admin"),
				entry("/admin/ghost"),
			]),
		).toEqual([
			"duplicate legacyPath: /admin",
			"missing legacyPath: /admin/users",
			"unknown legacyPath: /admin/ghost",
		]);
	});

	it("rejects incomplete decisions", () => {
		const issues = validateMigrationEntries(
			[page("/admin")],
			[{ ...entry("/admin"), targetPath: null, decision: "REBUILD" }],
		);

		expect(issues).toContain("REBUILD requires targetPath: /admin");
	});

	it("rejects a discovery surface mismatch for the same legacy path", () => {
		expect(
			validateMigrationEntries(
				[page("/admin")],
				[{ ...entry("/admin"), surface: "mod" }],
			),
		).toEqual([
			"surface mismatch for legacyPath /admin: expected admin, received mod",
		]);
	});

	it("rejects a discovery source file mismatch for the same legacy path", () => {
		expect(
			validateMigrationEntries(
				[page("/admin")],
				[
					{
						...entry("/admin"),
						sourceFile: "src/app/admin/renamed/page.tsx",
					},
				],
			),
		).toEqual([
			"sourceFile mismatch for legacyPath /admin: expected src/app/admin/page.tsx, received src/app/admin/renamed/page.tsx",
		]);
	});

	it("rejects removal with a non-null target", () => {
		expect(
			validateMigrationEntries(
				[page("/admin")],
				[
					{
						...entry("/admin"),
						decision: "REMOVE",
						targetPath: "/admin/system/legacy",
					},
				],
			),
		).toEqual(["REMOVE requires null targetPath: /admin"]);
	});

	it("enforces migration safety evidence", () => {
		const issues = validateMigrationEntries(
			[page("/admin")],
			[
				{
					...entry("/admin"),
					targetPath: "/mod/unsupported",
					decision: "MERGE",
					requiredTests: [],
					dependencies: { queries: [], mutations: ["users.disable"] },
					status: "VERIFIED",
					notes: ["TODO confirm ownership"],
				},
			],
		);

		expect(issues).toEqual([
			"MERGE requires requiredTests: /admin",
			"mutation dependencies require auditRequirement: /admin",
			"mutation dependencies require mutate capabilities: /admin",
			"non-REMOVE targetPath must start with /admin/: /admin",
			"prohibited placeholder: /admin",
			"VERIFIED requires parityEvidence: /admin",
		]);
	});

	it("allows removal without a target and rejects non-removal null targets", () => {
		expect(
			validateMigrationEntries(
				[page("/admin")],
				[{ ...entry("/admin"), decision: "REMOVE", targetPath: null }],
			),
		).toEqual([]);

		expect(
			validateMigrationEntries(
				[page("/admin")],
				[{ ...entry("/admin"), targetPath: null }],
			),
		).toEqual(["REHOST requires targetPath: /admin"]);
	});
});
