// @ts-nocheck
// @vitest-environment node
// Live integration audit for the furni import / catalog ID-consistency invariants.
//
// SAFETY: these tests modify data (reconcile, imports), so they only run when
// DATABASE_URL points at the throwaway sandbox container (127.0.0.1:3307).
// Asset + furnidata paths are redirected into a temp dir seeded with the real
// production FurnitureData.json, so production files are never touched.
import { promises as fs } from "node:fs";
import os from "node:os";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

vi.mock("@/lib/services/import/core/download", async () => {
	const fsMod = await import("node:fs/promises");
	return {
		downloadFile: vi.fn(async (_url: string, targetPath: string) => {
			await fsMod.writeFile(targetPath, Buffer.from("dummy-swf"));
			return { ok: true };
		}),
		validatePngBytes: vi.fn(() => true),
		validateSwfBytes: vi.fn(() => true),
	};
});

vi.mock("@/lib/services/swf-to-nitro", () => {
	const convertSwfToNitro = vi.fn((_buffer: Buffer, _classname: string) => ({
		bundle: Buffer.alloc(256, 0x42),
		classname: "n/a",
		dimensions: { x: 1, y: 1, z: 1 },
		directions: [0],
		spriteCount: 1,
		warnings: [],
		metadata: {
			visualizationType: "default",
			logicType: "",
			canstandon: false,
			cansiton: false,
			canlayon: false,
			specialtype: 0,
			defaultdir: 0,
			partcolors: { color: [] },
		},
	}));
	const extractIconFromSwf = vi.fn((_buffer: Buffer, _classname: string) =>
		Buffer.from("fake-icon"),
	);
	const parseNitroBundle = vi.fn(() => ({ json: null }));
	return {
		convertSwfToNitro,
		extractIconFromSwf,
		parseNitroBundle,
		convertSwfToNitroAsync: vi.fn(async (buffer: Buffer, classname: string) =>
			convertSwfToNitro(buffer, classname),
		),
		extractIconFromSwfAsync: vi.fn(async (buffer: Buffer, classname: string) =>
			extractIconFromSwf(buffer, classname),
		),
	};
});

vi.mock("@/lib/services/habbo-furnidata-cache", () => ({
	lookupOfficialHabboFurni: vi.fn(async () => null),
}));

vi.mock("@/lib/services/habbo-gamedata-hotel", () => ({
	getHabboGamedataHotel: vi.fn(async () => ""),
}));

import { sql } from "drizzle-orm";
import { db, ItemsBase } from "@/lib/db";
import {
	readFurniData,
	reconcileFurniDataWithItemsBase,
} from "@/lib/services/furni-data";
import {
	importSingleFurni,
	reconcileImportedOfferIds,
} from "@/lib/services/furni-import";

const isSandbox =
	process.env.DATABASE_URL?.includes("@127.0.0.1:3307") ||
	process.env.DATABASE_URL?.includes(":@127.0.0.1:3307/") ||
	process.env.DATABASE_URL?.includes("localhost:3307");

const describeGuard = isSandbox ? describe : describe.skip;

let tmpRoot: string;
let gamedataDir: string;

beforeAll(async () => {
	// Safety net: clean any leftovers from a previous (failed) run of this test
	// against the same sandbox DB, so the run is idempotent.
	try {
		await db.execute(
			sql`DELETE FROM catalog_items WHERE item_ids = '2000099901'`,
		);
		await db.execute(sql`DELETE FROM items_base WHERE id = 2000099901`);
		await db.execute(
			sql`DELETE FROM catalog_items WHERE item_ids IN (SELECT item_ids FROM (SELECT item_ids FROM catalog_items WHERE catalog_name LIKE 'zztst_live_audit_%') AS t)`,
		);
		await db.execute(
			sql`DELETE FROM items_base WHERE item_name LIKE 'zztst_live_audit_%'`,
		);
	} catch {
		// ignore cleanup failures; the assertions will surface real problems
	}

	tmpRoot = await fs.mkdtemp(getRuntimePath(os.tmpdir(), "furni-live-audit-"));
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

	// Seed the temp dir with the REAL production FurnitureData.json so the
	// reconcile test audits the actual on-disk file against the real rows.
	const productionFile = "/var/www/gamedata/config/FurnitureData.json";
	try {
		await fs.copyFile(
			productionFile,
			getRuntimePath(gamedataDir, "config", "FurnitureData.json"),
		);
	} catch {
		// file unavailable — reconcile test still runs against an empty file
	}
});

afterAll(async () => {
	await fs.rm(tmpRoot, { recursive: true, force: true });
	vi.clearAllMocks();
});

interface FdEntry {
	classname?: string;
	id?: number;
	offerid?: number;
}

function allEntries(fd: Record<string, { furnitype?: FdEntry[] }>): FdEntry[] {
	return [
		...(fd.roomitemtypes?.furnitype ?? []),
		...(fd.wallitemtypes?.furnitype ?? []),
	];
}

describeGuard("live furni import / catalog ID consistency (sandbox DB)", () => {
	it("reconcileFurniDataWithItemsBase aligns id + offerid for every item", async () => {
		const rows = await db
			.select({ id: ItemsBase.id, itemName: ItemsBase.itemName })
			.from(ItemsBase);
		expect(rows.length).toBeGreaterThan(1000);

		const buildMaps = (fd: Record<string, unknown>) => {
			const typed = fd as Record<string, { furnitype?: FdEntry[] }>;
			const byId = new Map<number, FdEntry>();
			const byClass = new Map<string, FdEntry>();
			for (const e of allEntries(typed)) {
				const id = Number(e.id);
				if (Number.isFinite(id) && id > 0 && !byId.has(id)) byId.set(id, e);
				if (e.classname && !byClass.has(e.classname))
					byClass.set(e.classname, e);
			}
			return { byId, byClass };
		};

		const before = buildMaps(await readFurniData());
		// Genuine id conflicts (our spriteId is owned by a different classname
		// in the file) are resolved in favour of items_base: the entry keeps its
		// id but its classname is overwritten with the items_base classname.
		let conflicts = 0;
		let missing = 0;
		for (const row of rows) {
			const owner = before.byId.get(row.id);
			if (owner && owner.classname !== row.itemName) {
				conflicts++;
				continue;
			}
			if (!before.byId.has(row.id) && !before.byClass.has(row.itemName)) {
				missing++;
			}
		}
		// Rows with a classname entry but no entry keyed by their sprite id are
		// exactly what the function fixes via the byName branch (fixedIds).
		let idMisBefore = 0;
		for (const row of rows) {
			if (before.byId.has(row.id)) continue;
			if (!before.byClass.has(row.itemName)) continue;
			idMisBefore++;
		}

		const result = await reconcileFurniDataWithItemsBase();
		expect(result.fixedIds).toBe(idMisBefore);
		expect(result.fixedConflicts).toBe(conflicts);
		expect(result.conflicts).toBe(0);
		expect(result.missing).toBe(missing);

		// Mirror the function's contract exactly: rows whose id IS keyed in the
		// file are handled by the byId branch (id correct by construction, only
		// offerid may need fixing); rows whose id is NOT keyed were fixed by the
		// byName branch and must now carry id === offerid === items_base.id in
		// their classname entry.
		//
		// Rows whose classname is DUPLICATED in items_base are excluded: the
		// furnidata file can only hold one id per classname, so a duplicate
		// classname can never satisfy this invariant for all its rows. Those
		// are repaired by the dedicated duplicate-classname tool, not by this
		// function. Genuine id conflicts are now resolved by overwriting the
		// entry's classname with the items_base value (see fixedConflicts).
		const dupClassnames = new Map<string, number>();
		for (const row of rows)
			dupClassnames.set(
				row.itemName,
				(dupClassnames.get(row.itemName) ?? 0) + 1,
			);

		const after = buildMaps(await readFurniData());
		let idMisAfter = 0;
		let offerMisAfter = 0;
		for (const row of rows) {
			if ((dupClassnames.get(row.itemName) ?? 0) > 1) continue;
			const byIdEntry = after.byId.get(row.id);
			if (byIdEntry) {
				if (byIdEntry.classname !== row.itemName) continue;
				if (Number(byIdEntry.offerid) !== row.id) offerMisAfter++;
				continue;
			}
			const byClassEntry = after.byClass.get(row.itemName);
			if (!byClassEntry) continue;
			if (Number(byClassEntry.id) !== row.id) idMisAfter++;
			if (Number(byClassEntry.offerid) !== row.id) offerMisAfter++;
		}
		expect(idMisAfter).toBe(0);
		expect(offerMisAfter).toBe(0);
	}, 120000);

	it("reconcileImportedOfferIds is idempotent and reaches zero in the tree", async () => {
		const first = await reconcileImportedOfferIds();
		const second = await reconcileImportedOfferIds();
		expect(second.fixed).toBe(0);
		expect(first.fixed).toBeGreaterThanOrEqual(0);
	});

	it("importSingleFurni aligns every id and supports updateExisting without PK collision", async () => {
		const id = 2000099901;
		const classname = `zztst_live_audit_${Date.now()}`;

		const first = await importSingleFurni({
			id,
			classname,
			name: "Live Audit Test Item",
			description: "",
			type: "flooritem",
			revision: 0,
			category: "unknown",
		});
		expect(first.ok, JSON.stringify(first)).toBe(true);

		const [row] = await db
			.select({
				id: ItemsBase.id,
				spriteId: ItemsBase.spriteId,
				itemName: ItemsBase.itemName,
			})
			.from(ItemsBase)
			.where(sql`${ItemsBase.itemName} = ${classname}`)
			.limit(1);
		expect(row).toBeDefined();
		expect(row.id).toBe(id);
		expect(row.spriteId).toBe(id);

		const [catalog] = (await db.execute(sql`
      SELECT id, item_ids, catalog_name, offer_id FROM catalog_items WHERE item_ids = ${String(id)}
    `)) as unknown as [
			Array<{
				id: number;
				item_ids: string;
				catalog_name: string;
				offer_id: number;
			}>,
			unknown,
		];
		expect(catalog).toHaveLength(1);
		expect(catalog[0].item_ids).toBe(String(id));
		expect(catalog[0].catalog_name).toBe(classname);
		expect(catalog[0].offer_id).toBe(catalog[0].id);

		// Re-import with updateExisting: previously fell through to an INSERT on
		// the existing PK and failed with "DB insert failed". Must now succeed.
		const second = await importSingleFurni({
			id,
			classname,
			name: "Live Audit Test Item",
			description: "",
			type: "flooritem",
			revision: 0,
			category: "unknown",
			updateExisting: true,
		});
		expect(second.ok, JSON.stringify(second)).toBe(true);

		const [afterRows] = (await db.execute(
			sql`SELECT COUNT(*) AS c FROM items_base WHERE item_name = ${classname}`,
		)) as unknown as [Array<{ c: number }>, unknown];
		expect(Number(afterRows[0].c)).toBe(1);
		const [row2] = await db
			.select({ id: ItemsBase.id, spriteId: ItemsBase.spriteId })
			.from(ItemsBase)
			.where(sql`${ItemsBase.itemName} = ${classname}`)
			.limit(1);
		expect(row2.id).toBe(id);
		expect(row2.spriteId).toBe(id);

		// Clean up the sandbox rows.
		await db.execute(
			sql`DELETE FROM catalog_items WHERE item_ids = ${String(id)}`,
		);
		await db.execute(sql`DELETE FROM items_base WHERE id = ${id}`);
	});
});
