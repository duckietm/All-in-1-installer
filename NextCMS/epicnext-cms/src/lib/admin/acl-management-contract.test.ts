import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ACL management contract", () => {
	it("uses normalized ACL persistence and the permissions.manage guard", () => {
		const source = readFileSync("src/actions/permissions.ts", "utf8");
		expect(source).toContain("PERMS.PERMISSIONS_MANAGE");
		expect(source).toContain("adminAction");
		expect(source).toContain("AclModelPermission");
		expect(source).not.toContain("websiteHousekeepingPermissions");
		expect(source).not.toContain("websiteTeams");
	});

	it("ships an idempotent ACL completion migration", () => {
		const sql = readFileSync(
			"drizzle/migrations/0014_complete_acl_and_import_permissions.sql",
			"utf8",
		);
		expect(sql).toContain("admin.assets.import");
		expect(sql).toContain("rank_");
		expect(sql).toContain("'Role'");
		expect(sql).toContain("'User'");
	});
});
