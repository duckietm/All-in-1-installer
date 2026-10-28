// @ts-nocheck
// @vitest-environment node

import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	nitroExists: true,
	write: vi.fn(),
	official: vi.fn(),
	download: vi.fn(),
	execute: vi.fn(),
	select: vi.fn(),
	stat: vi.fn(),
	conflict: vi.fn(),
	build: vi.fn(),
	append: vi.fn(),
}));
vi.mock("@/lib/db", async () => ({
	...(await import("@/test/db-helpers")).createDbHelpers(mocks.execute),
	db: { select: mocks.select, execute: mocks.execute },
	ItemsBase: {
		id: "id",
		itemName: "item_name",
		spriteId: "sprite_id",
		type: "type",
	},
	CatalogPages: {},
}));
vi.mock("node:fs", () => ({
	// Bundle presence covers both conventions: `.hab` is what imports write,
	// `.nitro` is what the legacy asset set holds.
	existsSync: (path: string) =>
		!/\.(?:nitro|hab)$/.test(path) || mocks.nitroExists,
	promises: {
		stat: mocks.stat,
		writeFile: mocks.write,
		readFile: vi.fn().mockResolvedValue(Buffer.alloc(256)),
	},
}));
vi.mock("@/lib/services/furni-asset-dirs", () => ({
	DEFAULT_FURNI_NITRO_DIR: "/nitro",
	getFurniAssetWriteTargets: async () => ({
		swfDir: "/swf",
		nitroDir: "/nitro",
		iconDir: "/icons",
		mirrorDirs: [],
	}),
}));
vi.mock("@/lib/services/furni-data", () => ({
	findFurniDataIdConflict: mocks.conflict,
	buildFurniEntry: mocks.build,
	appendFurniEntry: mocks.append,
}));
vi.mock("@/lib/services/habbo-furnidata-cache", () => ({
	lookupOfficialHabboFurni: mocks.official,
}));
vi.mock("@/lib/services/habbo-gamedata-hotel", () => ({
	getHabboGamedataHotel: async () => "it",
}));
vi.mock("@/lib/services/import/core/download", () => ({
	downloadFile: vi.fn(),
	tryDownloadCandidates: mocks.download,
}));
vi.mock("@/lib/services/swf-to-nitro", () => ({
	parseNitroBundle: () => ({ json: {} }),
	extractIconFromSwfAsync: async () => null,
	convertSwfToNitroAsync: async () => {
		throw Error("Source conversion failed");
	},
}));

import { importSingleFurni } from "./furni-import";

const input = {
	id: 42,
	classname: "recycler_scrapbookA",
	name: "Scrapbook",
	description: "Book",
	type: "flooritem",
	revision: 1,
	category: "unknown",
	repairExisting: true,
};
const dialect = new MySqlDialect();
function queries() {
	return mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));
}
describe("completion of existing furniture", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.nitroExists = true;
		mocks.write.mockImplementation(async () => {
			mocks.nitroExists = true;
		});
		mocks.official.mockResolvedValue(null);
		mocks.download.mockResolvedValue(false);
		const rows = [
			[{ id: 2000037257, spriteId: 9001, type: "s" }],
			[{ itemName: input.classname }],
		];
		mocks.select.mockImplementation(() => ({
			from: () => ({ where: () => ({ limit: async () => rows.shift() }) }),
		}));
		mocks.stat.mockResolvedValue({ size: 256 });
		mocks.conflict.mockResolvedValue(null);
		mocks.execute.mockResolvedValue([[{ id: 123, page_id: "15" }], []]);
		mocks.build.mockImplementation((value) => value);
	});
	it("recovers missing Nitro before completing the existing item without changing its IDs", async () => {
		mocks.nitroExists = false;
		const recover = vi.fn(async () => Buffer.alloc(256));
		const result = await importSingleFurni({
			...input,
			resolveMissingNitro: recover,
		});
		expect(recover).toHaveBeenCalledWith(1);
		expect(mocks.write).toHaveBeenCalledWith(
			expect.stringContaining("recycler_scrapbookA.hab"),
			expect.any(Buffer),
			{ flag: "wx" },
		);
		expect(result.ok).toBe(true);
		expect(result.itemId).toBe(2000037257);
	});

	it("reuses local item and sprite IDs without rewriting SQL settings or offers", async () => {
		const result = await importSingleFurni(input);
		expect(result.ok).toBe(true);
		expect(result.itemId).toBe(2000037257);
		expect(mocks.conflict).toHaveBeenCalledWith(9001, input.classname);
		expect(mocks.build).toHaveBeenCalledWith(
			expect.objectContaining({ id: 9001, spriteId: 9001 }),
		);
		expect(mocks.append).toHaveBeenCalled();
		expect(
			queries().every((query) => query.sql.trim().startsWith("SELECT")),
		).toBe(true);
		expect(queries()[0].params).toContain("2000037257");
	});
	it("never deletes existing SQL when the nitro cannot be recovered", async () => {
		mocks.stat.mockRejectedValue(new Error("missing"));
		const result = await importSingleFurni(input);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("preserved");
		expect(mocks.execute).not.toHaveBeenCalled();
		expect(mocks.append).not.toHaveBeenCalled();
	});
	it("rejects an occupied furnidata sprite before any mutation", async () => {
		mocks.conflict.mockResolvedValue("other_furniture");
		const result = await importSingleFurni(input);
		expect(result.ok).toBe(false);
		expect(mocks.execute).not.toHaveBeenCalled();
		expect(mocks.append).not.toHaveBeenCalled();
	});
});

it("imports recycler_kintsugiB with an allocated ID throughout SQL and furnidata", async () => {
	vi.clearAllMocks();
	mocks.nitroExists = false;
	const selections = [[], [{ itemName: "recycler_kintsugi" }]];
	mocks.select.mockImplementation(() => ({
		from: () => ({ where: () => ({ limit: async () => selections.shift() }) }),
	}));
	mocks.conflict.mockResolvedValue(null);
	mocks.stat.mockResolvedValue({ size: 256 });
	mocks.build.mockImplementation((value) => value);
	mocks.execute.mockImplementation(async (query) => {
		const { sql, params } = dialect.sqlToQuery(query);
		if (sql.includes("MAX(")) return [[{ maximum: 2000037257 }], []];
		if (sql.includes("SELECT item_name"))
			return [
				params[0] === 16940 ? [{ item_name: "recycler_kintsugi" }] : [],
				[],
			];
		if (sql.includes("SELECT id, page_id"))
			return [[{ id: 123, page_id: "15" }], []];
		return [[], []];
	});
	mocks.official.mockResolvedValue({ revision: 73706, xdim: 1, ydim: 1 });
	const result = await importSingleFurni({
		...input,
		revision: 0,
		id: 16940,
		classname: "recycler_kintsugiB",
	});
	expect(result.ok).toBe(true);
	expect(result.itemId).toBe(2000037258);
	expect(mocks.download).toHaveBeenCalledWith(
		expect.arrayContaining([
			"https://images.habbo.com/dcr/hof_furni/73706/recycler_kintsugiB.swf",
		]),
		expect.any(String),
		"swf",
		expect.any(Function),
	);
	expect(mocks.build).toHaveBeenCalledWith(
		expect.objectContaining({
			id: 2000037258,
			spriteId: 2000037258,
			classname: "recycler_kintsugiB",
		}),
	);
	expect(
		queries()
			.find((q) => q.sql.includes("INSERT INTO items_base"))
			?.params.slice(0, 2),
	).toEqual([2000037258, 2000037258]);
	expect(
		queries().find((q) => q.sql.includes("SELECT id, page_id"))?.params,
	).toContain("2000037258");
	expect(result.warnings.join(" ")).toContain("16940");
});

it("does not create or delete SQL rows when a new furniture asset is unavailable", async () => {
	vi.clearAllMocks();
	mocks.official.mockResolvedValue(null);
	mocks.download.mockResolvedValue(false);
	mocks.select.mockImplementation(() => ({
		from: () => ({ where: () => ({ limit: async () => [] }) }),
	}));
	mocks.stat.mockRejectedValue(new Error("missing"));
	mocks.conflict.mockResolvedValue(null);
	const result = await importSingleFurni({
		...input,
		classname: "missing_new_asset",
	});
	expect(result.ok).toBe(false);
	expect(result.error).toContain("Import not started");
	expect(mocks.execute).not.toHaveBeenCalled();
	expect(mocks.append).not.toHaveBeenCalled();
});
