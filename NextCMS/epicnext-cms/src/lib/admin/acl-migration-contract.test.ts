import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMS } from "@/lib/permission-slugs";

describe("production ACL migration", () => {
	const migrationsDir = resolve(process.cwd(), "drizzle/migrations");
	const allSql = readdirSync(migrationsDir)
		.filter((name) => name.endsWith(".sql"))
		.map((name) => readFileSync(resolve(migrationsDir, name), "utf8"))
		.join("\n");

	it("seeds every permission used by the application", () => {
		for (const slug of Object.values(PERMS)) {
			expect(allSql, `missing ACL seed for ${slug}`).toContain(`'${slug}'`);
		}
	});

	it("assigns dashboard access after seeding permissions", () => {
		const seedSql = readFileSync(
			resolve(migrationsDir, "0012_seed_acl_permissions.sql"),
			"utf8",
		);
		const seedPosition = seedSql.indexOf("INSERT INTO `acl_permissions`");
		const assignmentPosition = seedSql.indexOf(
			"INSERT INTO `acl_model_permissions`",
		);

		expect(seedPosition).toBeGreaterThanOrEqual(0);
		expect(assignmentPosition).toBeGreaterThan(seedPosition);
		expect(seedSql).toContain("ap.slug = 'admin.dashboard'");
		expect(seedSql).toContain("ap.slug = 'mod.dashboard'");
	});

	it("repairs full admin.* grants for ranks that already have dashboard", () => {
		const repairSql = readFileSync(
			resolve(migrationsDir, "0018_acl_repair_admin_nav_grants.sql"),
			"utf8",
		);
		expect(repairSql).toContain("admin.dashboard");
		expect(repairSql).toContain("ap.slug LIKE 'admin.%'");
		expect(repairSql).toContain("pr.id >= 6");
		expect(repairSql).toContain("pr.id >= 7");
	});
});
