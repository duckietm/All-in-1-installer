// @ts-nocheck
// Read-only live check for the Catalog Studio audit (`runCatalogAudit`).
// No repair/sql options are passed, so nothing is written: the DB is only
// SELECTed, gamedata dirs only listed, and clone-source furnidata only fetched
// for comparison. `ensureDirectories()` may create missing gamedata asset
// dirs, but never touches data.
//
// Deliberately not part of CI: it connects to the live hotel DB and hits the
// network (clone sources). Guarded by RUN_CATALOG_AUDIT_LIVE=1. Because vitest
// fakes DATABASE_URL in its config env, the real .env is loaded first.
//
// Usage:
//   RUN_CATALOG_AUDIT_LIVE=1 pnpm exec vitest run --coverage.enabled=false \
//     src/lib/services/catalog-audit-live.test.ts
import { readdir } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { loadEnvForLiveTests } from "@/test/live-env";

const runLive = process.env.RUN_CATALOG_AUDIT_LIVE === "1";
const KNOWN_EVENT_TYPES = new Set([
	"progress",
	"items_loaded",
	"catalog_loaded",
	"checking",
	"repair_complete",
	"sql_ready",
	"sql_applied",
	"furnidata_repair_complete",
	"structure_repair_complete",
	"batch_complete",
	"error",
]);

describe("catalog audit live (read-only)", {
	skip: process.env.RUN_CATALOG_AUDIT_LIVE !== "1",
}, () => {
	let db: typeof import("@/lib/db").db;
	let runCatalogAudit: typeof import("@/lib/services/catalog-audit").runCatalogAudit;
	let types: typeof import("@/lib/services/item-kind");

	beforeAll(async () => {
		// vitest's test.env injects a throwaway DATABASE_URL (root:root@:3306).
		// Replace it with the real .env value so the audit targets the hotel DB.
		loadEnvForLiveTests();

		const [dbMod, auditMod, typesMod] = await Promise.all([
			import("@/lib/db"),
			import("@/lib/services/catalog-audit"),
			import("@/lib/services/item-kind"),
		]);
		db = dbMod.db;
		runCatalogAudit = auditMod.runCatalogAudit;
		types = typesMod;
	});

	it("completes read-only and its summary matches independent measurements", async () => {
		expect(runLive).toBe(true);
		expect(process.env.DATABASE_URL).toMatch(/@/);
		expect(
			process.env.DATABASE_URL?.includes("root:root@localhost:3306/test"),
		).toBe(false);

		const events: Array<Record<string, unknown>> = [];
		await runCatalogAudit(
			(evt) => events.push(evt as unknown as Record<string, unknown>),
			{},
		);

		const errors = events.filter((e) => e.type === "error");
		expect(errors).toEqual([]);
		for (const evt of events) {
			expect(KNOWN_EVENT_TYPES.has(String(evt.type))).toBe(true);
		}

		const last = events[events.length - 1];
		expect(last?.type).toBe("batch_complete");
		const summary = last.summary as {
			totalItemsBase: number;
			totalCatalogItems: number;
			missingCatalog: number;
			orphanedCatalog: number;
			missingNitro: number;
			missingIcon: number;
			duplicates: number;
		};
		expect(summary).toBeDefined();

		// ── Independent measurements straight from the live DB ──────────
		const [itemRows] = (await db.execute(sql`
				SELECT id, item_name, public_name, type, interaction_type
				FROM items_base ORDER BY id
			`)) as unknown as [
			Array<{
				id: number;
				item_name: string;
				public_name: string;
				type: string;
				interaction_type: string;
			}>,
			unknown,
		];
		const [catalogRows] = (await db.execute(sql`
				SELECT id, item_ids, catalog_name FROM catalog_items ORDER BY id
			`)) as unknown as [
			Array<{ id: number; item_ids: string; catalog_name: string }>,
			unknown,
		];

		const itemIds = new Set(itemRows.map((r) => Number(r.id)));
		const catalogedIds = new Set<number>();
		for (const ci of catalogRows) {
			for (const id of ci.item_ids.split(";")) {
				const n = Number(id.trim());
				if (n) catalogedIds.add(n);
			}
		}

		// Duplicate classnames: count of names appearing > 1×.
		const nameCount = new Map<string, number>();
		for (const r of itemRows)
			nameCount.set(r.item_name, (nameCount.get(r.item_name) ?? 0) + 1);
		const duplicateGroups = [...nameCount.values()].filter((c) => c > 1).length;

		// Orphaned references: every (row, id) pointing at a missing sprite.
		let orphanedRefs = 0;
		for (const ci of catalogRows) {
			for (const id of ci.item_ids.split(";")) {
				const n = Number(id.trim());
				if (n && !itemIds.has(n)) orphanedRefs++;
			}
		}

		// Re-implement the audit's kind/asset logic so parity is exact:
		// badgeGifSet (album1584 .gif) nudges furni-looking rows to badge.
		const { getFurniAssetDirs, getGamedataRoot } = await import(
			"@/lib/services/furni-asset-dirs"
		);
		const { getRuntimePath } = await import("@/lib/utils/runtime-path");
		const [dirs, gamedataRoot] = await Promise.all([
			getFurniAssetDirs(),
			getGamedataRoot(),
		]);
		const [iconFiles, nitroFiles, badgeGifs] = await Promise.all([
			readdir(dirs.iconDir).catch(() => [] as string[]),
			readdir(dirs.nitroDir).catch(() => [] as string[]),
			gamedataRoot
				? readdir(getRuntimePath(gamedataRoot, "album1584")).catch(
						() => [] as string[],
					)
				: Promise.resolve([] as string[]),
		]);
		const iconSet = new Set(iconFiles);
		const nitroSet = new Set(nitroFiles);
		const badgeGifSet = new Set(
			badgeGifs.filter((f) => f.endsWith(".gif")).map((f) => f.slice(0, -4)),
		);

		const kindOf = (r: (typeof itemRows)[0]) => {
			let kind = types.classifyCatalogItem(r);
			if (
				kind === "furni" &&
				(types.isBadgeType(r.type) || badgeGifSet.has(r.item_name))
			) {
				kind = "badge";
			}
			return kind;
		};

		let missingCatalog = 0;
		let missingNitro = 0;
		let missingIcon = 0;
		for (const r of itemRows) {
			const kind = kindOf(r);
			if (
				!catalogedIds.has(Number(r.id)) &&
				!types.NO_CATALOG_KINDS.has(kind)
			) {
				missingCatalog++;
			}
			if (types.NO_ASSET_KINDS.has(kind)) continue;
			if (
				!types
					.assetNameCandidates(r.item_name, r.public_name)
					.nitro.some((n) => nitroSet.has(n))
			) {
				missingNitro++;
			}
			if (
				!types
					.assetNameCandidates(r.item_name, r.public_name)
					.icon.some((n) => iconSet.has(n))
			) {
				missingIcon++;
			}
		}

		expect(summary.totalItemsBase).toBe(itemRows.length);
		expect(summary.totalCatalogItems).toBe(catalogRows.length);
		expect(summary.duplicates).toBe(duplicateGroups);
		expect(summary.orphanedCatalog).toBe(orphanedRefs);
		expect(summary.missingCatalog).toBe(missingCatalog);
		expect(summary.missingNitro).toBe(missingNitro);
		expect(summary.missingIcon).toBe(missingIcon);

		expect(summary.totalItemsBase).toBeGreaterThan(0);
		expect(summary.totalCatalogItems).toBeGreaterThan(0);
		expect(missingCatalog).toBeGreaterThanOrEqual(0);
		expect(orphanedRefs).toBeGreaterThanOrEqual(0);
	}, 300_000);
});
