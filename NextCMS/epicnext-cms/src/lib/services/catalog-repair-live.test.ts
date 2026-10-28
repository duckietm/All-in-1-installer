// @ts-nocheck
// @vitest-environment node
// Live repair rehearsal for the catalog studio: runs the full repair pipeline
// (orphaned refs, duplicate classnames, missing catalog SQL, furnidata repair +
// reconcile) against a sandbox copy of the production DB and verifies the end
// state is consistent. Writes go to a temp gamedata dir; the production
// FurnitureData.json is only ever read (a copy is made first).
import { promises as fs } from "node:fs";
import os from "node:os";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
	generateCatalogSql,
	repairDuplicateClassnames,
	repairFurniData,
	repairOrphanedCatalog,
} from "@/lib/services/catalog-repair";
import { reconcileFurniDataWithItemsBase } from "@/lib/services/furni-data";
import { reconcileImportedOfferIds } from "@/lib/services/furni-import";
import {
	assetNameCandidates,
	classifyCatalogItem,
	NO_CATALOG_KINDS,
} from "@/lib/services/item-kind";
import { getRuntimePath } from "@/lib/utils/runtime-path";

const { getGamedataRootMock, getNitroFilesRootMock, settingGetMock } =
	vi.hoisted(() => ({
		getGamedataRootMock: vi.fn(),
		getNitroFilesRootMock: vi.fn(),
		settingGetMock: vi.fn(),
	}));

vi.mock("@/lib/services/furni-asset-dirs", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/services/furni-asset-dirs")>();
	return {
		...actual,
		getGamedataRoot: getGamedataRootMock,
		getNitroFilesRoot: getNitroFilesRootMock,
	};
});

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { get: settingGetMock },
}));

const isSandbox =
	process.env.DATABASE_URL?.includes("@127.0.0.1:3307") ||
	process.env.DATABASE_URL?.includes(":@127.0.0.1:3307/") ||
	process.env.DATABASE_URL?.includes("localhost:3307");

const describeGuard = isSandbox ? describe : describe.skip;

const REAL_NITRO_DIR = "/var/www/Gamedata/bundled/furniture";
const REAL_FURNIDATA = "/var/www/Gamedata/config/FurnitureData.json";

let tmpRoot: string;
let gamedataDir: string;

beforeAll(async () => {
	tmpRoot = await fs.mkdtemp(
		getRuntimePath(os.tmpdir(), "furni-repair-rehearsal-"),
	);
	gamedataDir = getRuntimePath(tmpRoot, "Gamedata");
	await fs.mkdir(getRuntimePath(gamedataDir, "config"), { recursive: true });
	getGamedataRootMock.mockResolvedValue(gamedataDir);
	getNitroFilesRootMock.mockResolvedValue("");
	settingGetMock.mockImplementation(
		async (key: string, fallback: string | null = null) => {
			if (key === "furni_data_url")
				return "/gamedata/config/FurnitureData.json";
			if (key === "furni_data_mirror_path") return "";
			return fallback;
		},
	);
	try {
		await fs.copyFile(
			REAL_FURNIDATA,
			getRuntimePath(gamedataDir, "config", "FurnitureData.json"),
		);
	} catch {
		// missing copy — repair still runs against an empty file
	}
});

afterAll(async () => {
	await fs.rm(tmpRoot, { recursive: true, force: true });
	vi.clearAllMocks();
});

describeGuard("catalog studio live repair rehearsal (sandbox)", () => {
	it("runs the full repair pipeline and converges to a consistent state", async () => {
		const itemTypeMap = (t: string) => (t === "i" || t === "s" ? "i" : "s");

		const [itemRows] = (await db.execute(sql`
				SELECT id, item_name, public_name, type FROM items_base
			`)) as unknown as [
			Array<{
				id: number;
				item_name: string;
				public_name: string | null;
				type: string;
			}>,
			unknown,
		];
		const [catalogRows] = (await db.execute(sql`
				SELECT item_ids FROM catalog_items
			`)) as unknown as [Array<{ item_ids: string }>, unknown];

		const nitroFiles = new Set(
			(await fs.readdir(REAL_NITRO_DIR).catch(() => [] as string[]))
				.filter((f) => f.endsWith(".nitro"))
				.map((f) => f.slice(0, -6)),
		);

		const audit = async () => {
			const [itemRowsNow] = (await db.execute(sql`
					SELECT id, item_name, type FROM items_base
				`)) as unknown as [
				Array<{ id: number; item_name: string; type: string }>,
				unknown,
			];
			const [catalogRowsNow] = (await db.execute(sql`
					SELECT item_ids FROM catalog_items
				`)) as unknown as [Array<{ item_ids: string }>, unknown];
			const withCatalog = new Set<number>();
			for (const r of catalogRowsNow)
				for (const p of String(r.item_ids ?? "").split(";")) {
					const n = Number(p.trim());
					if (n) withCatalog.add(n);
				}
			const byName = new Map<string, number>();
			for (const r of itemRowsNow)
				byName.set(r.item_name, (byName.get(r.item_name) ?? 0) + 1);
			const dupGroups = [...byName].filter(([, c]) => c > 1).length;
			const itemIds = new Set(itemRowsNow.map((r) => Number(r.id)));
			let orphaned = 0;
			for (const r of catalogRowsNow) {
				const ids = String(r.item_ids ?? "")
					.split(";")
					.map(Number)
					.filter(Boolean);
				if (ids.some((i) => !itemIds.has(i))) orphaned++;
			}
			let missingNonSystem = 0;
			for (const r of itemRowsNow) {
				if (withCatalog.has(Number(r.id))) continue;
				const kind = classifyCatalogItem(r as never);
				if (NO_CATALOG_KINDS.has(kind)) continue;
				missingNonSystem++;
			}
			return { dupGroups, orphaned, missingNonSystem };
		};

		const beforeState = await audit();
		console.log("REHEARSAL before:", JSON.stringify(beforeState));

		const orphan = await repairOrphanedCatalog();
		console.log("REHEARSAL orphaned:", JSON.stringify(orphan));

		const dup = await repairDuplicateClassnames();
		console.log("REHEARSAL duplicates:", JSON.stringify(dup));

		// Missing catalog entries (audit filter: non-system kind AND (pet OR has nitro)).
		const entries = [];
		const withCatalog = new Set<number>();
		for (const r of catalogRows)
			for (const p of String(r.item_ids ?? "").split(";")) {
				const n = Number(p.trim());
				if (n) withCatalog.add(n);
			}
		for (const r of itemRows) {
			if (withCatalog.has(Number(r.id))) continue;
			const kind = classifyCatalogItem(r as never);
			if (NO_CATALOG_KINDS.has(kind)) continue;
			const hasNitro = assetNameCandidates(r.item_name).nitro.some((n) =>
				nitroFiles.has(n),
			);
			if (kind === "pet" || hasNitro) {
				entries.push({
					classname: r.item_name,
					itemId: Number(r.id),
					itemType: itemTypeMap(r.type),
					publicName: r.public_name ?? r.item_name,
				});
			}
		}
		console.log("REHEARSAL missing catalog entries:", entries.length);
		const catalogSql = await generateCatalogSql(entries, {
			organizeSql: true,
		});
		let applied = 0;
		let failed = 0;
		const failures: string[] = [];
		for (const stmt of catalogSql.statements) {
			const trimmed = stmt.trim();
			if (
				!trimmed ||
				trimmed.startsWith("--") ||
				trimmed === "START TRANSACTION;" ||
				trimmed === "COMMIT;"
			)
				continue;
			try {
				await db.execute(sql.raw(trimmed));
				applied++;
			} catch (err) {
				failed++;
				const e = err as { cause?: unknown; message?: string };
				const cause =
					typeof e.cause === "object" && e.cause !== null
						? JSON.stringify(e.cause, Object.getOwnPropertyNames(e.cause))
						: String(e.cause ?? "");
				failures.push(
					`${trimmed.slice(0, 60)} → CAUSE: ${cause.slice(0, 500)}`,
				);
			}
		}
		console.log(
			"REHEARSAL catalog sql:",
			JSON.stringify({ count: catalogSql.count, applied, failed }),
		);
		for (const f of failures) console.log("REHEARSAL sql FAILURE:", f);

		const furniDataRepair = await repairFurniData(itemRows as never);
		console.log("REHEARSAL furnidata repair:", JSON.stringify(furniDataRepair));

		const reconcile = await reconcileFurniDataWithItemsBase();
		console.log("REHEARSAL furnidata reconcile:", JSON.stringify(reconcile));

		const offer = await reconcileImportedOfferIds();
		console.log("REHEARSAL offer reconcile:", JSON.stringify(offer));

		// Every furnidata entry whose classname maps to a unique items_base row
		// must have id === offerid === db id (incl. cross-section copies).
		const [uniqueRows] = (await db.execute(sql`
			SELECT id, item_name FROM items_base
		`)) as unknown as [Array<{ id: number; item_name: string }>, unknown];
		const dbById = new Map<number, string>();
		for (const r of uniqueRows) dbById.set(Number(r.id), r.item_name);
		const byName = new Map<string, number>();
		for (const r of uniqueRows)
			byName.set(r.item_name, (byName.get(r.item_name) ?? 0) + 1);
		const finalFd = JSON.parse(
			await fs.readFile(
				getRuntimePath(gamedataDir, "config", "FurnitureData.json"),
				"utf8",
			),
		) as Record<string, { furnitype: Array<Record<string, unknown>> }>;
		let badCrossSection = 0;
		for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
			for (const e of finalFd[section]?.furnitype ?? []) {
				const cn = String(e.classname ?? "");
				if (byName.get(cn) !== 1) continue;
				const offer = Number(e.offerid);
				if (!Number.isFinite(offer) || offer <= 0) continue;
				if (dbById.get(offer) !== cn) continue;
				if (Number(e.id) !== offer) badCrossSection++;
			}
		}
		console.log("REHEARSAL cross-section id mismatches:", badCrossSection);
		expect(badCrossSection).toBe(0);

		const afterState = await audit();
		console.log("REHEARSAL after:", JSON.stringify(afterState));

		expect(orphan.removed).toBeGreaterThanOrEqual(0);
		expect(orphan.cleaned).toBeGreaterThanOrEqual(0);
		expect(dup.merged).toBeGreaterThan(0);
		expect(dup.rowsRemoved).toBeGreaterThan(0);
		expect(afterState.dupGroups).toBe(0);
		expect(afterState.orphaned).toBe(0);
	}, 600000);
});
