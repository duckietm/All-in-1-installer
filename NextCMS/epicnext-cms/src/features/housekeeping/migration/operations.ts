import { PERMS } from "@/lib/permission-slugs";
import type { MigrationEntry } from "./types";

export const operationsMigrationEntries: readonly MigrationEntry[] = [
	{
		surface: "admin",
		legacyPath: "/admin",
		sourceFile: "src/app/admin/page.tsx",
		targetDomain: "operations",
		targetPath: "/admin/work",
		decision: "REBUILD",
		capabilities: { read: [PERMS.ADMIN_DASHBOARD], mutate: [] },
		dependencies: {
			queries: ["users", "active bans", "website articles", "staff activities"],
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
	},
	{
		surface: "admin",
		legacyPath: "/admin/operations",
		sourceFile: "src/app/admin/operations/page.tsx",
		targetDomain: "operations",
		targetPath: "/admin/work/jobs",
		decision: "REHOST",
		capabilities: {
			read: [PERMS.ASSETS_IMPORT],
			mutate: [PERMS.ASSETS_IMPORT],
		},
		dependencies: {
			queries: ["ImportJobStore", "catalogExportStatus"],
			mutations: ["retry furniture import", "cancel furniture import"],
		},
		auditRequirement: "MUTATION",
		localization: "PARTIAL",
		accessibility: "PARTIAL",
		requiredTests: ["unit", "integration", "e2e", "visual"],
		parityEvidence: [],
		status: "PLANNED",
		notes: ["Owner-scoped import history and shared export status"],
	},
];
