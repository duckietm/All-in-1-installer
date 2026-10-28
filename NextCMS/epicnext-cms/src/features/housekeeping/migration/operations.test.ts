import { describe, expect, it } from "vitest";
import { PERMS } from "@/lib/permission-slugs";
import { operationsMigrationEntries } from "./operations";

describe("operationsMigrationEntries", () => {
	it("covers the legacy dashboard once", () => {
		expect(operationsMigrationEntries).toHaveLength(2);
		expect(operationsMigrationEntries[0]).toMatchObject({
			surface: "admin",
			legacyPath: "/admin",
			sourceFile: "src/app/admin/page.tsx",
			targetDomain: "operations",
			targetPath: "/admin/work",
			decision: "REBUILD",
			capabilities: { read: [PERMS.ADMIN_DASHBOARD], mutate: [] },
			dependencies: {
				queries: [
					"users",
					"active bans",
					"website articles",
					"staff activities",
				],
				mutations: [],
			},
			auditRequirement: "NONE",
			localization: "COMPLETE",
			accessibility: "PARTIAL",
			requiredTests: ["integration", "e2e", "visual"],
			parityEvidence: [],
			status: "PLANNED",
			notes: [
				"Replace metric dashboard with capability-derived operational home",
			],
		});
	});
});
