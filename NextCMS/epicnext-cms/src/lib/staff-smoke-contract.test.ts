// @ts-nocheck
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("staff smoke contract", () => {
	it("gates photos delete with PAGES_EDIT", () => {
		const src = readFileSync("src/actions/admin-photos.ts", "utf8");
		expect(src).toContain("PERMS.PAGES_EDIT");
		expect(src).toContain("deletePhoto");
		expect(src).toContain("logStaffActivity");
		expect(existsSync("src/app/admin/photos/page.tsx")).toBe(true);
		expect(readFileSync("src/app/admin/photos/page.tsx", "utf8")).toContain(
			"AdminPageShell",
		);
	});

	it("gates bans create/lift", () => {
		expect(existsSync("src/app/admin/bans/page.tsx")).toBe(true);
		const bans = readFileSync("src/actions/admin-bans.ts", "utf8");
		expect(bans).toContain("liftBan");
		expect(bans).toContain("createBan");
		expect(readFileSync("src/app/admin/bans/page.tsx", "utf8")).toContain(
			"AdminPageShell",
		);
	});

	it("wires ban appeal lift on help tickets", () => {
		const actions = readFileSync("src/actions/admin-help-tickets.ts", "utf8");
		expect(actions).toContain("liftBanFromHelpTicket");
		expect(actions).toContain("PERMS.USERS_BAN");
		const detail = readFileSync(
			"src/app/admin/help-tickets/[id]/admin-help-ticket-detail.tsx",
			"utf8",
		);
		expect(detail).toContain("liftBanFromHelpTicket");
		expect(detail).toContain("canLiftBan");
	});

	it("exposes operational overview on user show", () => {
		expect(
			existsSync(
				"src/app/admin/users/_components/user-operational-overview.tsx",
			),
		).toBe(true);
		expect(existsSync("src/app/admin/users/_lib/load-user-overview.ts")).toBe(
			true,
		);
		expect(
			readFileSync("src/app/admin/users/show/[id]/page.tsx", "utf8"),
		).toContain("UserOperationalOverview");
	});

	it("applies CMS SQL from drizzle/migrations (not Prisma)", () => {
		expect(existsSync("drizzle/migrations")).toBe(true);
		expect(existsSync("prisma")).toBe(false);
		expect(readFileSync("scripts/apply-migrations.ts", "utf8")).toContain(
			"drizzle/migrations",
		);
		const pkg = readFileSync("package.json", "utf8");
		expect(pkg).not.toContain('"prisma"');
		expect(pkg).not.toContain('"@prisma/client"');
		expect(pkg).not.toContain("prisma:generate");
		expect(pkg).toContain('"db:generate": "drizzle-kit generate"');
		expect(pkg).toContain('"db:studio": "drizzle-kit studio"');
		expect(pkg).toContain('"db:migrate": "tsx scripts/apply-migrations.ts"');
		expect(readFileSync("drizzle.config.ts", "utf8")).toContain(
			"./drizzle/drafts",
		);
	});

	it("ships shared ops + ticket queue helpers", () => {
		expect(existsSync("src/lib/admin/ops-health.ts")).toBe(true);
		const ops = readFileSync("src/lib/admin/ops-health.ts", "utf8");
		expect(ops).toContain("redisOk");
		expect(ops).toContain("redis.ping");
		expect(existsSync("src/lib/admin/ticket-queue-counts.ts")).toBe(true);
		expect(existsSync("src/lib/admin/ops-online-users.ts")).toBe(true);
	});

	it("keeps sidebar configuration without exposing the retired menu editor", () => {
		expect(existsSync("src/lib/admin-nav-config.ts")).toBe(true);
		expect(existsSync("src/app/admin/menu/page.tsx")).toBe(false);
		expect(readFileSync("src/lib/admin-nav.ts", "utf8")).not.toContain(
			"/admin/menu",
		);
		expect(readFileSync("src/lib/admin-navigation.ts", "utf8")).toContain(
			"applyAdminNavConfig",
		);
		expect(readFileSync("src/lib/admin/navigation.ts", "utf8")).toContain(
			"ADMIN_NAV_CONFIG_KEY",
		);
	});

	it("opts admin/mod out of static caching via instant=false", () => {
		// The Cache Components migration replaced `force-dynamic` with
		// `export const instant = false` — the legacy export must not survive.
		let legacyHits = 0;
		function walk(dir: string) {
			for (const name of readdirSync(dir)) {
				const p = join(dir, name);
				if (statSync(p).isDirectory()) walk(p);
				else if (/\.(tsx?|jsx?)$/.test(name)) {
					const src = readFileSync(p, "utf8");
					if (
						/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/.test(src)
					) {
						legacyHits++;
					}
				}
			}
		}
		walk("src/app/admin");
		walk("src/app/mod");
		expect(legacyHits).toBe(0);

		// The root layout carries the single Cache Components opt-out; staff
		// pages inherit it (was force-dynamic, then per-layout instant=false).
		expect(readFileSync("src/app/layout.tsx", "utf8")).toContain(
			"export const instant = false",
		);
		// Staff layouts must not redeclare the opt-out — that is the root
		// layout's job now, and redeclaring it is the legacy per-layout pattern.
		expect(readFileSync("src/app/admin/layout.tsx", "utf8")).not.toContain(
			"export const instant",
		);
		expect(readFileSync("src/app/mod/layout.tsx", "utf8")).not.toContain(
			"export const instant",
		);
	});

	it("caches analytics via redisCache", () => {
		for (const path of [
			"src/app/admin/analytics/page.tsx",
			"src/app/admin/analytics/activity/page.tsx",
			"src/app/admin/analytics/economy/page.tsx",
		]) {
			expect(readFileSync(path, "utf8"), path).toContain("redisCache");
		}
	});

	it("exports bulk adjust currency and trade lock", () => {
		const src = readFileSync("src/actions/bulk-users.ts", "utf8");
		expect(src).toContain("bulkAdjustCurrency");
		expect(src).toContain("setTradeLock");
		expect(src).toContain("tradeLockedUntil");
		expect(src).toContain("UsersSettings");
		expect(src).toContain("rcon.setTradeLock");
	});

	it("deletes photos via Drizzle with local file purge helper", () => {
		const src = readFileSync("src/actions/admin-photos.ts", "utf8");
		expect(src).toContain("CameraWeb");
		expect(src).toContain("tryRemoveLocalPhotoFile");
		expect(src).toContain("@/lib/admin/photo-files");
		expect(src).toContain("@/lib/db");
	});

	it("guards dual ticket queues on admin and mod", () => {
		for (const path of [
			"src/app/admin/tickets/desk/page.tsx",
			"src/app/admin/help-tickets/page.tsx",
			"src/app/mod/tickets/desk/page.tsx",
			"src/app/mod/help-tickets/page.tsx",
			"src/app/admin/tickets/[id]/page.tsx",
			"src/app/admin/help-tickets/[id]/page.tsx",
			"src/app/mod/tickets/[id]/page.tsx",
			"src/app/mod/help-tickets/[id]/page.tsx",
		]) {
			expect(existsSync(path), path).toBe(true);
			expect(readFileSync(path, "utf8"), path).toContain("TicketQueueBanner");
			expect(readFileSync(path, "utf8"), path).toContain(
				"fetchTicketQueueOpenCounts",
			);
		}
	});

	it("ships unified ticket inbox over both queues", () => {
		expect(existsSync("src/lib/admin/ticket-inbox.ts")).toBe(true);
		expect(readFileSync("src/lib/admin/ticket-inbox.ts", "utf8")).toContain(
			"fetchUnifiedTicketInbox",
		);
		expect(existsSync("src/components/admin/unified-tickets-table.tsx")).toBe(
			true,
		);
		expect(readFileSync("src/app/admin/tickets/page.tsx", "utf8")).toContain(
			"fetchUnifiedTicketInbox",
		);
		expect(readFileSync("src/app/mod/tickets/page.tsx", "utf8")).toContain(
			"fetchUnifiedTicketInbox",
		);
		expect(readFileSync("src/lib/admin-nav.ts", "utf8")).toContain(
			"ticketInbox",
		);
	});

	it("keeps StatusCard server-safe without client boundary", () => {
		expect(
			readFileSync("src/components/admin/dashboard.tsx", "utf8"),
		).not.toMatch(/^["']use client["']/m);
		expect(existsSync("src/components/admin/online-users-widget.tsx")).toBe(
			true,
		);
		expect(
			readFileSync("src/components/admin/online-users-widget.tsx", "utf8"),
		).toContain("use client");
		expect(existsSync("src/app/admin/ads/edit-ad-delete-button.tsx")).toBe(
			true,
		);
	});

	it("ships ops health alerts, optional DB backup, and health rate limit", () => {
		const worker = readFileSync("scripts/jobs-worker.ts", "utf8");
		expect(worker).toContain("checkOpsHealth");
		expect(worker).toContain("healthDegraded");
		expect(worker).toContain("backupDatabase");
		expect(readFileSync("src/lib/services/alert.ts", "utf8")).toContain(
			"healthDegraded",
		);
		expect(readFileSync("src/app/cms_api/health/route.ts", "utf8")).toContain(
			"rateLimit",
		);
		expect(readFileSync("src/actions/admin-alerts.ts", "utf8")).toContain(
			"markAllAlertsRead",
		);
		expect(readFileSync("src/env.ts", "utf8")).toContain("DB_BACKUP_DIR");
	});

	it("documents local-only photo file purge", () => {
		expect(readFileSync("src/app/admin/photos/page.tsx", "utf8")).toContain(
			"purgeHint",
		);
		expect(readFileSync("src/messages/en.json", "utf8")).toContain(
			"External CDN URLs are not purged",
		);
	});

	it("ships items base admin CRUD", () => {
		expect(existsSync("src/app/admin/items/page.tsx")).toBe(true);
		expect(existsSync("src/app/admin/items/[id]/page.tsx")).toBe(true);
		expect(readFileSync("src/actions/items-base.ts", "utf8")).toContain(
			"updateItemsBase",
		);
		expect(readFileSync("src/lib/admin-nav.ts", "utf8")).toContain(
			"/admin/items",
		);
	});

	it("ships studio hub with synced badge import path", () => {
		const nav = readFileSync("src/lib/admin-nav.ts", "utf8");
		expect(nav).toContain('href: "/admin/studio"');
		expect(nav).toContain('labelKey: "studio"');
		expect(nav).toContain('"/admin/studio"');
		expect(existsSync("src/lib/services/import-badge.ts")).toBe(true);
		const badgeService = readFileSync(
			"src/lib/services/import-badge.ts",
			"utf8",
		);
		expect(badgeService).toContain("ExternalTexts.json");
		expect(badgeService).toContain("WebsiteBadges");
		expect(badgeService).toContain("importBadgeSynced");
	});
});
