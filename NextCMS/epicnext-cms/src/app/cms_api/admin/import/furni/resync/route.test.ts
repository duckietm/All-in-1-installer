import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRouteContext } from "@/test/route-context";

const state = vi.hoisted(() => ({
	localIndex: new Map<string, Array<{ id: number; itemName: string }>>(),
	rows: [] as Array<Record<string, unknown>>,
	append: vi.fn(async (_entries: unknown[]) => {}),
	clear: vi.fn(),
	rconCatalog: vi.fn(async () => true),
	rconItems: vi.fn(async () => true),
	official: vi.fn(
		async (_classname: string) => null as Record<string, unknown> | null,
	),
	sources: [] as unknown[],
	fetchSource: vi.fn(async (_url: string) => [] as unknown[]),
}));

vi.mock("@/lib/api-handler", () => ({
	withAdmin: (_options: unknown, handler: unknown) => handler,
}));

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = await importOriginal<typeof import("drizzle-orm")>();
	return {
		...actual,
		inArray: (...args: unknown[]) => ({ op: "in", args }),
		asc: (col: unknown) => ({ op: "asc", col }),
	};
});

vi.mock("@/lib/db", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: async () => state.rows,
				orderBy: async () => state.rows,
			}),
		}),
	},
	ItemsBase: {
		id: "id",
		spriteId: "spriteId",
		itemName: "itemName",
		publicName: "publicName",
		type: "type",
		width: "width",
		length: "length",
		stackHeight: "stackHeight",
	},
	queryRows: vi.fn(async () => []),
}));

vi.mock("@/lib/services/furni-import-cache", () => ({
	getLocalCatalogSnapshot: async () => ({
		localIndex: state.localIndex,
		importedSet: new Set(state.localIndex.keys()),
		timestamp: 0,
	}),
	clearFurniImportCache: state.clear,
}));

vi.mock("@/lib/services/furni-data", () => ({
	appendFurniEntriesBatch: state.append,
	// Mirrors the real coercion closely enough to assert the fields a
	// retro-hotel classname would otherwise lose.
	buildFurniEntry: (params: {
		id: number;
		classname: string;
		revision: number;
		category: string;
		name: string;
		description: string;
	}) => ({
		id: params.id,
		classname: params.classname,
		revision: params.revision,
		category: params.category,
		name: params.name,
		description: params.description,
	}),
	getFurnitureDataPath: async () => "/nonexistent/furnidata.json",
	readFurniData: async () => ({}),
}));

vi.mock("@/lib/services/habbo-furnidata-cache", () => ({
	lookupOfficialHabboFurni: state.official,
}));

vi.mock("@/lib/services/clone-sources", () => ({
	listSources: async () => state.sources,
}));

vi.mock("@/lib/services/clone-import", () => ({
	fetchSourceFurnidata: state.fetchSource,
}));

vi.mock("@/lib/services/rcon", () => ({
	rcon: {
		updateCatalog: state.rconCatalog,
		updateItems: state.rconItems,
	},
}));

import { POST } from "./route";

const post = (body?: unknown) =>
	new NextRequest("http://localhost/cms_api/admin/import/furni/resync", {
		method: "POST",
		body: body === undefined ? undefined : JSON.stringify(body),
	});

function firstEntry(): Record<string, unknown> {
	const calls = state.append.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	const entries = calls[0]?.[0] as Array<{ entry: Record<string, unknown> }>;
	const first = entries?.[0];
	if (!first) throw new Error("no furnidata entry was written");
	return first.entry;
}

beforeEach(() => {
	state.localIndex = new Map([
		["chair", [{ id: 1, itemName: "chair" }]],
		["table", [{ id: 2, itemName: "table" }]],
	]);
	state.rows = [
		{ id: 1, itemName: "chair", spriteId: 1, type: "s" },
		{ id: 2, itemName: "table", spriteId: 2, type: "s" },
	];
	state.sources = [];
	state.official.mockClear().mockResolvedValue(null);
	state.fetchSource.mockClear().mockResolvedValue([]);
	state.append.mockClear();
	state.clear.mockClear();
	state.rconCatalog.mockClear();
	state.rconItems.mockClear();
});

describe("resync with an explicit classname selection", () => {
	it("resyncs only the rows matching the sent classnames", async () => {
		const response = await POST(
			post({ classnames: ["chair", "table", "ghost"] }),
			emptyRouteContext(),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			mode: "classnames",
			examined: 2,
			resynced: 2,
			failed: 0,
			rconOk: true,
		});
		expect(state.append).toHaveBeenCalledTimes(1);
		const entries = state.append.mock.calls[0]?.[0] as Array<{
			entry: { classname: string };
		}>;
		expect(entries.map((e) => e.entry.classname).sort()).toEqual([
			"chair",
			"table",
		]);
	});

	it("matches classnames case-insensitively", async () => {
		const response = await POST(
			post({ classnames: ["CHAIR", "  "] }),
			emptyRouteContext(),
		);
		const body = await response.json();
		expect(body.examined).toBe(1);
	});

	it("drops the cached classname set so the listing recomputes", async () => {
		await POST(post({ classnames: ["chair"] }), emptyRouteContext());
		expect(state.clear).toHaveBeenCalledTimes(1);
	});

	it("is a no-op for an empty selection", async () => {
		const response = await POST(post({ classnames: [] }), emptyRouteContext());
		const body = await response.json();
		expect(body).toMatchObject({ examined: 0, resynced: 0 });
		expect(state.append).not.toHaveBeenCalled();
		expect(state.clear).not.toHaveBeenCalled();
		expect(state.rconCatalog).not.toHaveBeenCalled();
	});
});

describe("resync entry data for retro-hotel classnames", () => {
	/** A leet.ws-only classname: present in items_base, absent from official Habbo. */
	const retroRow = {
		id: 3,
		itemName: "sh Uni*1",
		spriteId: 3,
		publicName: "Shabby Uni",
		type: "i",
		width: 1,
		length: 1,
		stackHeight: 1,
	};

	const retroSourceEntry = {
		id: 3,
		classname: "sh Uni*1",
		revision: 42,
		category: "sh Uni",
		name: "Uni Shabby",
		description: "Een leuk stoeltje",
		defaultdir: 0,
		xdim: 1,
		ydim: 1,
		partcolors: { color: ["3d3d3d"] },
		specialtype: 0,
		canstandon: false,
		cansiton: false,
		canlayon: false,
		furniline: "uni",
		environment: "",
		rare: false,
		bc: false,
		customparams: "",
		itemType: "i",
	};

	it("uses the clone source's revision, category and description", async () => {
		state.localIndex = new Map([
			["sh uni*1", [{ id: 3, itemName: "sh Uni*1" }]],
		]);
		state.rows = [retroRow];
		state.sources = [
			{ id: "leet", furnidataUrl: "https://leet.ws/furnidata", enabled: true },
		];
		state.fetchSource.mockResolvedValue([retroSourceEntry]);

		const response = await POST(
			post({ classnames: ["sh Uni*1"] }),
			emptyRouteContext(),
		);

		expect((await response.json()).resynced).toBe(1);
		expect(firstEntry()).toMatchObject({
			classname: "sh Uni*1",
			id: 3,
			revision: 42,
			category: "sh Uni",
			description: "Een leuk stoeltje",
		});
	});

	it("prefers items_base public_name over the source name", async () => {
		state.localIndex = new Map([
			["sh uni*1", [{ id: 3, itemName: "sh Uni*1" }]],
		]);
		state.rows = [retroRow];
		state.sources = [
			{ id: "leet", furnidataUrl: "https://leet.ws/furnidata", enabled: true },
		];
		state.fetchSource.mockResolvedValue([retroSourceEntry]);

		await POST(post({ classnames: ["sh Uni*1"] }), emptyRouteContext());
		expect(firstEntry()).toMatchObject({ name: "Shabby Uni" });
	});

	it("skips a disabled source", async () => {
		state.localIndex = new Map([
			["sh uni*1", [{ id: 3, itemName: "sh Uni*1" }]],
		]);
		state.rows = [retroRow];
		state.sources = [
			{ id: "leet", furnidataUrl: "https://leet.ws/furnidata", enabled: false },
		];

		await POST(post({ classnames: ["sh Uni*1"] }), emptyRouteContext());
		expect(state.fetchSource).not.toHaveBeenCalled();
		expect(firstEntry()).toMatchObject({ revision: 0, category: "unknown" });
	});

	it("still resyncs when a source is unreachable", async () => {
		state.localIndex = new Map([
			["sh uni*1", [{ id: 3, itemName: "sh Uni*1" }]],
		]);
		state.rows = [retroRow];
		state.sources = [
			{ id: "leet", furnidataUrl: "https://leet.ws/furnidata", enabled: true },
		];
		state.fetchSource.mockRejectedValue(new Error("502 from leet.ws"));

		const response = await POST(
			post({ classnames: ["sh Uni*1"] }),
			emptyRouteContext(),
		);
		const body = await response.json();
		expect(body).toMatchObject({ resynced: 1, failed: 0 });
		expect(firstEntry()).toMatchObject({ revision: 0, category: "unknown" });
	});

	it("never contacts a clone source when official Habbo has the classname", async () => {
		state.sources = [
			{ id: "leet", furnidataUrl: "https://leet.ws/furnidata", enabled: true },
		];
		state.official.mockResolvedValue({
			id: 1,
			classname: "chair",
			revision: 7,
			category: "chair",
			name: "Chair",
			description: "",
		});

		await POST(post({ classnames: ["chair"] }), emptyRouteContext());
		expect(state.fetchSource).not.toHaveBeenCalled();
		expect(firstEntry()).toMatchObject({ revision: 7, category: "chair" });
	});
});

describe("resync query-param modes", () => {
	it("falls back to the default days mode when no body is sent", async () => {
		const response = await POST(post(), emptyRouteContext());
		// post() sends no JSON at all, so request.json() must reject and be
		// swallowed rather than turning the request into a targeted resync.
		const body = await response.json();
		expect(response.status).toBe(200);
		expect(body.mode).toBe("days");
		expect(state.append).not.toHaveBeenCalled();
	});

	it("still honours the missing mode via query params", async () => {
		const response = await POST(
			new NextRequest(
				"http://localhost/cms_api/admin/import/furni/resync?missing=1",
				{ method: "POST" },
			),
			emptyRouteContext(),
		);
		const body = await response.json();
		expect(body.mode).toBe("missing");
		expect(state.append).toHaveBeenCalledTimes(1);
	});
});
