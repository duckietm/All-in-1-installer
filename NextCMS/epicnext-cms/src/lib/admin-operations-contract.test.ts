// @ts-nocheck
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES: Array<[string, string]> = [
	["moderation", "PERMS.MODERATION_VIEW"],
	["moderation/actions", "PERMS.MODERATION_EDIT"],
	["moderation/cfh", "PERMS.MODERATION_VIEW"],
	["logs/audit", "PERMS.LOGS_VIEW"],
	["analytics", "PERMS.ANALYTICS_VIEW"],
	["devops", "PERMS.DEVOPS_VIEW"],
	["online", "PERMS.USERS_VIEW"],
	["commandocentrum", "PERMS.RCON_EXECUTE"],
	["users/edit/[id]", "PERMS.USERS_EDIT"],
	["settings", "PERMS.SETTINGS_VIEW"],
	["theme", "PERMS.SETTINGS_VIEW"],
	["emulator", "PERMS.SETTINGS_VIEW"],
	["bans", "PERMS.BANS_VIEW"],
	["wordfilter", "PERMS.WORDFILTER_VIEW"],
	["articles", "PERMS.NEWS_VIEW"],
	["shop", "PERMS.SHOP_VIEW"],
	["transactions", "PERMS.SHOP_VIEW"],
	["vouchers", "PERMS.SHOP_VIEW"],
	["marketplace", "PERMS.SHOP_VIEW"],
	["vpn", "PERMS.SETTINGS_VIEW"],
	["ip", "PERMS.SETTINGS_VIEW"],
	["maintenance", "PERMS.SETTINGS_VIEW"],
	["alerts", "PERMS.NOTIFICATIONS_VIEW"],
	["tags", "PERMS.PAGES_VIEW"],
	["ads", "PERMS.PAGES_VIEW"],
	["media", "PERMS.PAGES_VIEW"],
	["photos", "PERMS.PAGES_VIEW"],
	["badges", "PERMS.CATALOG_VIEW"],
	["teams", "PERMS.USERS_VIEW"],
	["applications", "PERMS.USERS_VIEW"],
	["guilds", "PERMS.USERS_VIEW"],
	["tickets", "PERMS.TICKETS_VIEW"],
	["help-tickets", "PERMS.TICKETS_VIEW"],
	["permissions", "PERMS.PERMISSIONS_MANAGE"],
	["housekeeping", "PERMS.SETTINGS_VIEW"],
	["logs", "PERMS.LOGS_VIEW"],
	["catalog", "PERMS.CATALOG_VIEW"],
	["items", "PERMS.CATALOG_VIEW"],
	["items/[id]", "PERMS.CATALOG_VIEW"],
	["rooms/edit/[id]", "PERMS.ROOMS_EDIT"],
];

const MOD_ROUTES: Array<[string, string]> = [
	["", "requireMod"],
	["cfh", "PERMS.MOD_CFH_VIEW"],
	["actions", "PERMS.MOD_ACTIONS"],
	["bans", "PERMS.MOD_BANS_VIEW"],
	["tickets", "PERMS.MOD_TICKETS_VIEW"],
	["help-tickets", "PERMS.MOD_TICKETS_VIEW"],
	["users", "PERMS.MOD_USERS_VIEW"],
	["team", "PERMS.MOD_TEAM_VIEW"],
];

const ACTION_GATES: Array<[string, string]> = [
	["admin-settings.ts", "PERMS.SETTINGS_EDIT"],
	["admin-theme.ts", "PERMS.SETTINGS_EDIT"],
	["admin-emulator.ts", "PERMS.SETTINGS_EDIT"],
	["admin-bans.ts", "PERMS.USERS_BAN"],
	["admin-wordfilter.ts", "PERMS.WORDFILTER_EDIT"],
	["admin-articles.ts", "PERMS.NEWS_EDIT"],
	["admin-shop.ts", "PERMS.SHOP_EDIT"],
	["admin-radio-autodj.ts", "PERMS.RADIO_EDIT"],
	["catalog.ts", "PERMS.CATALOG_EDIT"],
	["items-base.ts", "PERMS.CATALOG_EDIT"],
	["rooms.ts", "PERMS.ROOMS_EDIT"],
	["admin-vpn.ts", "PERMS.SETTINGS_EDIT"],
	["admin-ads.ts", "PERMS.PAGES_EDIT"],
	["admin-vouchers.ts", "PERMS.SHOP_EDIT"],
	["admin-alerts.ts", "PERMS.NOTIFICATIONS_EDIT"],
	["admin-antiddos.ts", "PERMS.SETTINGS_EDIT"],
	["commandocentrum.ts", "PERMS.RCON_EXECUTE"],
	["translations.ts", "PERMS.SETTINGS_EDIT"],
	["tickets.ts", "PERMS.TICKETS_EDIT"],
	["admin-help-tickets.ts", "PERMS.TICKETS_EDIT"],
	["permissions.ts", "PERMS.PERMISSIONS_MANAGE"],
	["permissions.ts", "repairAdminNavAclGrants"],
	["admin-guilds.ts", "PERMS.USERS_EDIT"],
	["moderation.ts", "PERMS.MODERATION_EDIT"],
];

describe("admin operations route contract", () => {
	it.each(ROUTES)("provides and guards /admin/%s", (route, permission) => {
		const path = `src/app/admin/${route}/page.tsx`;
		expect(existsSync(path), path).toBe(true);
		expect(readFileSync(path, "utf8"), path).toContain(permission);
	});

	it.each(MOD_ROUTES)("provides and guards /mod/%s", (route, permission) => {
		const path =
			route === "" ? "src/app/mod/page.tsx" : `src/app/mod/${route}/page.tsx`;
		expect(existsSync(path), path).toBe(true);
		const source = readFileSync(path, "utf8");
		const layout = readFileSync("src/app/mod/layout.tsx", "utf8");
		if (permission === "requireMod") {
			expect(layout).toContain("requireMod");
		} else {
			expect(source).toContain(permission);
		}
	});

	it("guards radio section via layout", () => {
		const path = "src/app/admin/radio/layout.tsx";
		expect(existsSync(path), path).toBe(true);
		expect(readFileSync(path, "utf8"), path).toContain("PERMS.RADIO_VIEW");
	});

	it.each([
		["analytics/export", "PERMS.ANALYTICS_EXPORT"],
		["devops/health", "PERMS.DEVOPS_VIEW"],
		["users/actions", "PERMS.USERS_EDIT"],
	])("provides and guards /api/admin/%s", (route, permission) => {
		const path = `src/app/api/admin/${route}/route.ts`;
		expect(existsSync(path), path).toBe(true);
		expect(readFileSync(path, "utf8"), path).toContain(permission);
	});

	it.each(ACTION_GATES)("guards %s with %s", (file, permission) => {
		const source = readFileSync(`src/actions/${file}`, "utf8");
		expect(source).toContain(permission);
		expect(source).not.toMatch(/await requireStaff\(\)/);
		expect(source).not.toMatch(/await requireStaffRateLimited\(\)/);
	});

	it("has no requireStaff left in admin action modules", () => {
		const dir = "src/actions";
		const offenders: string[] = [];
		for (const name of readdirSync(dir)) {
			if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
			const source = readFileSync(join(dir, name), "utf8");
			if (/await requireStaff(RateLimited)?\(\)/.test(source)) {
				offenders.push(name);
			}
		}
		expect(offenders).toEqual([]);
	});

	it("caches analytics full-scans via redisCache", () => {
		for (const path of [
			"src/app/admin/analytics/page.tsx",
			"src/app/admin/analytics/activity/page.tsx",
			"src/app/admin/analytics/economy/page.tsx",
		]) {
			expect(readFileSync(path, "utf8"), path).toContain("redisCache");
		}
	});

	it("shares ops health probe across CC / DevOps / API", () => {
		expect(existsSync("src/lib/admin/ops-health.ts")).toBe(true);
		expect(
			readFileSync("src/app/admin/commandocentrum/page.tsx", "utf8"),
		).toContain("fetchOpsHealth");
		expect(readFileSync("src/app/admin/devops/page.tsx", "utf8")).toContain(
			"fetchOpsHealth",
		);
		expect(
			readFileSync("src/app/api/admin/devops/health/route.ts", "utf8"),
		).toContain("fetchOpsHealth");
	});
});
