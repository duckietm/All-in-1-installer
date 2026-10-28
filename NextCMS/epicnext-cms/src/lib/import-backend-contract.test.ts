// @ts-nocheck
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROUTES = [
	"audit",
	"badges",
	"badges/edit",
	"clone",
	"clone/batch",
	"clone/icon",
	"clone/sync-all",
	"clothing",
	"clothing/batch",
	"clothing/sets",
	"clothing/sets/batch",
	"effects",
	"effects/batch",
	"furni",
	"furni/batch",
	"furni/batch-regen",
	"furni/nitro-editor",
	"furni/repair-icons",
	"furni/resync",
	"furni/upload",
	"pets",
	"pets/batch",
	"pets/icon",
];

describe("admin import backend contract", () => {
	it.each(ROUTES)("provides and guards /api/admin/import/%s", (route) => {
		const path = `src/app/api/admin/import/${route}/route.ts`;
		expect(existsSync(path), path).toBe(true);
		const source = readFileSync(path, "utf8");
		expect(source, path).toContain("PERMS.ASSETS_IMPORT");
	});

	it("does not leave import actions as successful no-op stubs", () => {
		const source = readFileSync("src/actions/import-furni.ts", "utf8");
		expect(source).not.toContain("deleted: 0, remaining: 0");
	});

	it("keeps badge import ExternalTexts + WebsiteBadges in sync", () => {
		const service = readFileSync("src/lib/services/import-badge.ts", "utf8");
		expect(service).toContain("ExternalTexts.json");
		expect(service).toContain("WebsiteBadges");
		expect(service).toContain("importBadgeSynced");
		expect(
			readFileSync("src/app/api/admin/import/badges/route.ts", "utf8"),
		).toContain("importBadgeSynced");
	});
});
