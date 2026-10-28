import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	canImportBundles,
	DEFAULT_CATALOG_SYNC_FLAGS,
	describeActions,
	parseCatalogSyncArgs,
	selectImportCandidates,
	writeGeneratedSql,
} from "./catalog-sync";

const entry = (classname: string) =>
	({ classname, name: classname, itemType: "s" }) as never;

describe("catalog-sync argument parsing", () => {
	it("defaults to a read-only audit with no filters", () => {
		expect(parseCatalogSyncArgs([])).toEqual({
			...DEFAULT_CATALOG_SYNC_FLAGS,
			sourceIds: [],
		});
		expect(describeActions(parseCatalogSyncArgs([]))).toBe("audit");
	});

	it("accepts comma-separated source ids", () => {
		const flags = parseCatalogSyncArgs([
			"--sources=default-habbo-com,default-wibbo",
		]);
		expect(flags.sourceIds).toEqual(["default-habbo-com", "default-wibbo"]);
	});

	it("accepts display names, including ones with spaces", () => {
		const flags = parseCatalogSyncArgs(["--sources=Habbo (COM), Wibbo"]);
		expect(flags.sourceIds).toEqual(["Habbo (COM)", "Wibbo"]);
	});

	it("trims and drops empty source entries", () => {
		expect(parseCatalogSyncArgs(["--sources= a , ,b,"]).sourceIds).toEqual([
			"a",
			"b",
		]);
	});

	it("turns --all into every repair step", () => {
		const flags = parseCatalogSyncArgs(["--all"]);
		expect(flags.repairIcons).toBe(true);
		expect(flags.repairNitros).toBe(true);
		expect(flags.repairFurniData).toBe(true);
		expect(flags.repairStructure).toBe(true);
		expect(flags.checkFurniDataIds).toBe(true);
		// Generating/applying SQL is never implied by a repair.
		expect(flags.generateSql).toBe(false);
		expect(flags.applySql).toBe(false);
	});

	it("treats applying SQL as implying generation", () => {
		expect(parseCatalogSyncArgs(["--apply-sql"]).generateSql).toBe(true);
		expect(parseCatalogSyncArgs(["--organize-sql"]).generateSql).toBe(true);
		expect(describeActions(parseCatalogSyncArgs(["--apply-sql"]))).toBe(
			"audit + apply-sql",
		);
	});

	it("accepts the alias spellings of the repair flags", () => {
		const flags = parseCatalogSyncArgs([
			"--repair-icons",
			"--repair-nitros",
			"--repair-furnidata",
			"--repair-structure",
		]);
		expect(flags.repairIcons).toBe(true);
		expect(flags.repairNitros).toBe(true);
		expect(flags.repairFurniData).toBe(true);
		expect(flags.repairStructure).toBe(true);
	});

	it("ignores a bare -- separator", () => {
		expect(parseCatalogSyncArgs(["--", "--icons"]).repairIcons).toBe(true);
	});

	it("rejects an unknown flag", () => {
		expect(() => parseCatalogSyncArgs(["--nope"])).toThrow(/Unknown flag/);
	});

	it("rejects --sources without a value", () => {
		expect(() => parseCatalogSyncArgs(["--sources"])).toThrow(/needs a value/);
	});
});

describe("catalog-sync import selection", () => {
	it("skips furniture this hotel already has", () => {
		const candidates = selectImportCandidates(
			[entry("chair"), entry("table"), entry("") as never],
			new Set(["chair"]),
		);
		expect(candidates.map((c) => c.classname)).toEqual(["table"]);
	});

	it("is case-insensitive against the present set", () => {
		const candidates = selectImportCandidates(
			[entry("Chair"), entry("table")],
			new Set(["chair"]),
		);
		expect(candidates.map((c) => c.classname)).toEqual(["table"]);
	});

	it("honours the --only filter, also case-insensitively", () => {
		const candidates = selectImportCandidates(
			[entry("Chair"), entry("table"), entry("lamp")],
			new Set(),
			{ only: ["chair"] },
		);
		expect(candidates.map((c) => c.classname)).toEqual(["Chair"]);
	});

	it("caps the list with --limit", () => {
		const candidates = selectImportCandidates(
			[entry("a"), entry("b"), entry("c")],
			new Set(),
			{ limit: 2 },
		);
		expect(candidates.map((c) => c.classname)).toEqual(["a", "b"]);
	});

	it("returns everything when no limit is given", () => {
		expect(
			selectImportCandidates([entry("a"), entry("b")], new Set(), {
				limit: 0,
			}).length,
		).toBe(2);
	});
});

describe("catalog-sync import feasibility", () => {
	it("imports from a source that serves bundles", () => {
		expect(
			canImportBundles({
				id: "default-habblet-city",
				name: "Habblet City",
				furnidataUrl: "https://www.habblet.city/gamedata/furnidata.json",
				nitroBaseUrl: "https://www.habblet.city/nitro/bundled/furniture",
				iconBaseUrl: "",
				hotel: "com",
			} as never),
		).toBe(true);
	});

	// The Habbo presets have no nitro/icon base URL: their furnidata can be
	// compared, but there is nothing to download from.
	it("does not import from a compare-only source", () => {
		expect(
			canImportBundles({
				id: "default-habbo-com",
				name: "Habbo (COM)",
				furnidataUrl: "https://www.habbo.com/gamedata/furnidata_json/1",
				nitroBaseUrl: "",
				iconBaseUrl: "",
				hotel: "com",
			} as never),
		).toBe(false);
	});
});

describe("catalog-sync step composition", () => {
	it("--everything turns on every step except the writing ones", () => {
		const flags = parseCatalogSyncArgs(["--everything"]);
		expect(describeActions(flags)).toBe(
			[
				"audit",
				"icons",
				"nitros",
				"furnidata",
				"structure",
				"id-check",
				"import",
				"reconcile",
				"sprite-ids",
				"offers",
			].join(" + "),
		);
		// Destructive steps stay opt-in even inside --everything.
		expect(flags.applySql).toBe(false);
		expect(flags.apply).toBe(false);
		expect(flags.alignIds).toBe(false);
		expect(flags.renameBundles).toBe(false);
	});

	it("marks an import as a dry run", () => {
		expect(
			describeActions(parseCatalogSyncArgs(["--import-new", "--dry-run"])),
		).toContain("import (dry)");
	});

	it("marks the child steps as reporting unless --apply is given", () => {
		expect(
			describeActions(
				parseCatalogSyncArgs(["--align-ids", "--rename-bundles"]),
			),
		).toContain("align-ids");
		expect(
			describeActions(
				parseCatalogSyncArgs(["--align-ids", "--rename-bundles", "--apply"]),
			),
		).toContain("rename=apply-bundles");
	});

	it("parses the import tuning flags", () => {
		const flags = parseCatalogSyncArgs([
			"--import-new",
			"--limit=50",
			"--concurrency=8",
			"--only=chair,table",
		]);
		expect(flags.importLimit).toBe(50);
		expect(flags.importConcurrency).toBe(8);
		expect(flags.importOnly).toEqual(["chair", "table"]);
	});

	it("rejects a non-numeric --limit", () => {
		expect(() => parseCatalogSyncArgs(["--limit=abc"])).toThrow(/integer/);
	});

	it("rejects --dry-run without an import to preview", () => {
		expect(() => parseCatalogSyncArgs(["--dry-run"])).toThrow(
			/together with --import-new/,
		);
	});
});

describe("generated catalog SQL output", () => {
	let cwd = "";

	beforeEach(() => {
		cwd = process.cwd();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.chdir(cwd);
	});

	it("writes the SQL under storage/catalog-sync with a trailing newline", async () => {
		let target = "";
		try {
			const dir = mkdtempSync(join(tmpdir(), "catalog-sync-sql-"));
			target = dir;
			process.chdir(dir);
			const file = await writeGeneratedSql("INSERT INTO `catalog_items` (1);");
			expect(file.startsWith("storage/catalog-sync/")).toBe(true);
			expect(file.endsWith(".sql")).toBe(true);
			expect(readFileSync(join(dir, file), "utf8")).toBe(
				"INSERT INTO `catalog_items` (1);\n",
			);
		} finally {
			if (target) rmSync(target, { recursive: true, force: true });
		}
	});
});
