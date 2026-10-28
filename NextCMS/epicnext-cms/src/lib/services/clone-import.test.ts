// @ts-nocheck
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type AnyFn = (...args: any[]) => any;

const {
	downloadFile,
	appendFurniEntry,
	parseNitroBundle,
	executeFn,
	selectLimit,
	fsUnlink,
	fsReadFile,
	fetchWithByparr,
	curlFetchText,
	curlDownload,
} = vi.hoisted(() => ({
	downloadFile: vi.fn<AnyFn>(async () => ({ ok: true, size: 200 })),
	appendFurniEntry: vi.fn<AnyFn>(async () => {}),
	parseNitroBundle: vi.fn<AnyFn>(() => ({ json: {}, png: Buffer.alloc(0) })),
	executeFn: vi.fn<AnyFn>(async () => [[{ next: 1 }], []]),
	selectLimit: vi.fn<AnyFn>(async () => []),
	fsUnlink: vi.fn<AnyFn>(async () => {}),
	fsReadFile: vi.fn<AnyFn>(async () => Buffer.from("NITRO")),
	fetchWithByparr: vi.fn<AnyFn>(async () => ""),
	curlFetchText: vi.fn<AnyFn>(async () => ""),
	curlDownload: vi.fn<AnyFn>(async () => ({ ok: true, size: 200 })),
}));

vi.mock("@/lib/services/import/core/download", () => ({ downloadFile }));
vi.mock("@/lib/services/import/core/curl-fetch", () => ({
	curlDownload,
	curlFetchText,
}));
vi.mock("@/lib/services/byparr", () => ({ fetchWithByparr }));
vi.mock("@/lib/services/furni-data", () => ({ appendFurniEntry }));
vi.mock("@/lib/services/furni-import", () => ({
	ensureDirectories: vi.fn<AnyFn>(async () => {}),
	getOrCreateCategoryPage: vi.fn<AnyFn>(async () => 99),
	autoPriceFurni: vi.fn<AnyFn>(() => ({
		credits: 5,
		points: 0,
		pointsType: 0,
	})),
	allocateCatalogItemId: vi.fn<AnyFn>(
		async (fn: (n: number) => Promise<unknown>) => fn(1000),
	),
}));
vi.mock("@/lib/services/furni-asset-dirs", () => ({
	getFurniAssetDirs: vi.fn<AnyFn>(async () => ({
		nitroDir: "/tmp/nitro",
		iconDir: "/tmp/icons",
		swfDir: "/tmp/swf",
	})),
}));
vi.mock("@/lib/services/swf/nitro-builder", () => ({ parseNitroBundle }));
vi.mock("node:fs", async (orig) => {
	const real = (await orig()) as typeof import("node:fs");
	return {
		...real,
		promises: {
			...real.promises,
			readFile: fsReadFile as AnyFn,
			unlink: fsUnlink as AnyFn,
		},
	};
});
vi.mock("@/lib/db", async () => ({
	...(await import("@/test/db-helpers")).createDbHelpers(executeFn),
	db: {
		execute: executeFn,
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: selectLimit,
				})),
			})),
		})),
	},
	ItemsBase: { id: "id", itemName: "itemName" },
}));

import {
	__resetItemsBaseAllocatorForTests,
	cloneSingleFurni,
	fetchSourceFurnidata,
	parseFurnidata,
} from "./clone-import";

const SOURCE = {
	id: "s",
	name: "X",
	furnidataUrl: "https://x/fd.json",
	nitroBaseUrl: "https://x/furni",
	iconBaseUrl: "https://x/icons",
	hotel: "",
};
const ENTRY = {
	id: 5,
	classname: "bc_sofa",
	name: "BC Sofa",
	description: "d",
	xdim: 2,
	ydim: 1,
	canstandon: false,
	cansiton: true,
	canlayon: false,
	customparams: "",
};

describe("clone-import", () => {
	beforeEach(() => {
		__resetItemsBaseAllocatorForTests();
	});

	it("parseFurnidata normalizes room + wall items with itemType", () => {
		const list = parseFurnidata({
			roomitemtypes: { furnitype: [ENTRY] },
			wallitemtypes: { furnitype: [{ ...ENTRY, classname: "wall_x" }] },
		});
		expect(list.find((e) => e.classname === "bc_sofa")?.itemType).toBe("s");
		expect(list.find((e) => e.classname === "wall_x")?.itemType).toBe("i");
	});

	it("cloneSingleFurni downloads .nitro+icon, inserts items_base, appends FurnitureData, makes catalog item", async () => {
		// Reset mocks to clear state from other tests.
		downloadFile.mockReset();
		downloadFile.mockResolvedValue({ ok: true, size: 200 });
		executeFn.mockReset();
		// allocateItemsBaseId MAX(id)+1, then items_base INSERT, then catalog INSERT.
		executeFn
			.mockResolvedValueOnce([[{ next: 42 }], []])
			.mockResolvedValueOnce([[], []])
			.mockResolvedValueOnce([[], []]);
		selectLimit.mockReset();
		selectLimit.mockResolvedValue([]);
		appendFurniEntry.mockReset();
		appendFurniEntry.mockResolvedValue(undefined);

		const r = await cloneSingleFurni({
			source: SOURCE,
			entry: { ...ENTRY, itemType: "s" },
		});
		expect(r.ok).toBe(true);
		expect(downloadFile).toHaveBeenCalledWith(
			"https://x/furni/bc_sofa.nitro",
			expect.any(String),
			expect.any(Object),
		);
		expect(downloadFile).toHaveBeenCalledWith(
			"https://x/icons/bc_sofa_icon.png",
			expect.any(String),
			expect.objectContaining({ validate: "png" }),
		);
		expect(appendFurniEntry).toHaveBeenCalled();
		expect(executeFn).toHaveBeenCalled(); // items_base insert + catalog
	});

	it("skips when classname already exists (dedup)", async () => {
		selectLimit.mockReset();
		selectLimit.mockResolvedValueOnce([{ id: 5 }]); // existing items_base row
		const r = await cloneSingleFurni({
			source: SOURCE,
			entry: { ...ENTRY, itemType: "s" },
		});
		expect(r.ok).toBe(false);
		expect(r.skipped).toBe(true);
	});

	it("rolls back: unlinks the bundle and icon, skips FurnitureData when items_base INSERT rejects", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		downloadFile.mockReset();
		downloadFile.mockResolvedValue({ ok: true, size: 200 });
		fsUnlink.mockReset();
		fsUnlink.mockResolvedValue(undefined);
		appendFurniEntry.mockReset();
		selectLimit.mockReset();
		executeFn.mockReset();
		// Dedup query: no existing row.
		selectLimit.mockResolvedValueOnce([]);
		// allocateItemsBaseId: MAX(id)+1 query returns next id.
		executeFn.mockResolvedValueOnce([[{ next: 7 }], []]);
		// items_base INSERT rejects.
		executeFn.mockRejectedValueOnce(new Error("Duplicate entry"));

		try {
			const r = await cloneSingleFurni({
				source: SOURCE,
				entry: { ...ENTRY, itemType: "s" },
			});

			// (a) the bundle (`.hab`) must be unlinked.
			expect(fsUnlink).toHaveBeenCalledWith(
				expect.stringContaining("bc_sofa.hab"),
			);
			// (b) icon must also be unlinked.
			expect(fsUnlink).toHaveBeenCalledWith(
				expect.stringContaining("bc_sofa_icon.png"),
			);
			// (c) appendFurniEntry must NOT have been called.
			expect(appendFurniEntry).not.toHaveBeenCalled();
			// (d) result must be ok === false.
			expect(r.ok).toBe(false);
			expect(r.error).toMatch(/items_base insert failed/);
		} finally {
			warn.mockRestore();
		}
	});
});

describe("fetchSourceFurnidata", () => {
	const FD = {
		roomitemtypes: { furnitype: [{ classname: "bc_sofa" }] },
		wallitemtypes: { furnitype: [{ classname: "wall_x" }] },
	};
	const JSON_BODY = JSON.stringify(FD);
	const HTML_WRAPPED = `<html><head><meta charset="utf-8"></head><body><pre>${JSON_BODY}</pre></body></html>`;

	beforeEach(() => {
		fetchWithByparr.mockReset();
		fetchWithByparr.mockResolvedValue("");
		vi.unstubAllGlobals();
	});

	it("parses a plain JSON furnidata directly", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON_BODY, {
						status: 200,
						headers: { "content-type": "application/json" },
					}),
			),
		);
		const list = await fetchSourceFurnidata("https://a.test/fd.json", 1);
		expect(list.map((e) => e.classname)).toEqual(["bc_sofa", "wall_x"]);
		expect(fetchWithByparr).not.toHaveBeenCalled();
	});

	it("extracts JSON from an HTML-wrapped furnidata (e.g. Leet via Byparr)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response("<html>challenge</html>", {
						status: 403,
						headers: { "content-type": "text/html" },
					}),
			),
		);
		fetchWithByparr.mockResolvedValue(HTML_WRAPPED);
		const list = await fetchSourceFurnidata("https://b.test/fd.json", 1);
		expect(list.map((e) => e.classname)).toEqual(["bc_sofa", "wall_x"]);
		expect(fetchWithByparr).toHaveBeenCalledWith("https://b.test/fd.json");
	});

	it("falls back to Byparr on HTML body even when status is 200", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(HTML_WRAPPED, {
						status: 200,
						headers: { "content-type": "text/html" },
					}),
			),
		);
		fetchWithByparr.mockResolvedValue(HTML_WRAPPED);
		const list = await fetchSourceFurnidata("https://c.test/fd.json", 1);
		expect(list.map((e) => e.classname)).toEqual(["bc_sofa", "wall_x"]);
	});

	it("parses JSON served with text/plain content-type directly (e.g. GitHub raw)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON_BODY, {
						status: 200,
						headers: { "content-type": "text/plain; charset=utf-8" },
					}),
			),
		);
		const list = await fetchSourceFurnidata("https://g.test/fd.json", 1);
		expect(list.map((e) => e.classname)).toEqual(["bc_sofa", "wall_x"]);
		expect(fetchWithByparr).not.toHaveBeenCalled();
	});

	it("throws when HTML has no embedded JSON payload", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response("<html>challenge</html>", {
						status: 403,
						headers: { "content-type": "text/html" },
					}),
			),
		);
		fetchWithByparr.mockResolvedValue("<html>still a challenge</html>");
		await expect(
			fetchSourceFurnidata("https://d.test/fd.json", 1),
		).rejects.toThrow(/Cloudflare challenge/);
	});
});

it("preserves numeric source revisions for asset downloads", () => {
	const [entry] = parseFurnidata({
		roomitemtypes: {
			furnitype: [
				{ id: 16940, classname: "recycler_kintsugiB", revision: "73706" },
			],
		},
	});
	expect(entry.revision).toBe(73706);
});
