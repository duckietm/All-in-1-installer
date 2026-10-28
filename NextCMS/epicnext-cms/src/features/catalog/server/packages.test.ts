import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	pages: [] as Record<string, unknown>[],
	offers: [] as Record<string, unknown>[],
	stored: {} as Record<string, string>,
	queries: [] as string[],
	liveWrites: 0,
	failAt: 0,
	duplicateAt: 0,
	nextPage: 200,
	nextOffer: 500,
	bases: [8],
}));
vi.mock("@/lib/services/furni-import", () => ({
	allocateCatalogItemId: async (fn: (id: number) => unknown) =>
		fn(state.nextOffer++),
}));
vi.mock("@/lib/db", async () => ({
	rowsFrom: (await import("@/test/db-helpers")).rowsFrom,
	db: {
		transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
			const before = structuredClone({
				pages: state.pages,
				offers: state.offers,
				stored: state.stored,
			});
			try {
				return await fn({
					execute: async (q: SQL) => {
						const { sql, params } = new MySqlDialect().sqlToQuery(q);
						state.queries.push(sql);
						if (sql.startsWith("SELECT")) {
							if (sql.includes("website_catalog_packages"))
								return [
									[
										...(state.stored[String(params[0])]
											? [{ payload: state.stored[String(params[0])] }]
											: []),
									],
									[],
								];
							if (sql.includes("FROM catalog_pages"))
								return [structuredClone(state.pages), []];
							if (sql.includes("FROM catalog_items"))
								return [
									structuredClone(
										state.offers.filter((o) =>
											params.map(String).includes(String(o.page_id)),
										),
									),
									[],
								];
							if (sql.includes("items_base"))
								return [state.bases.map((id) => ({ id })), []];
						}
						if (sql.startsWith("INSERT INTO website_catalog_packages")) {
							state.stored[String(params[0])] = String(params[5]);
							return [{}, []];
						}
						if (sql.startsWith("UPDATE website_catalog_packages")) {
							state.stored[String(params[4])] = String(params[3]);
							return [{}, []];
						}
						if (sql.startsWith("INSERT") || sql.startsWith("UPDATE")) {
							state.liveWrites++;
							if (state.duplicateAt === state.liveWrites)
								throw Object.assign(Error("reserved ID collision"), {
									errno: 1062,
								});
							if (state.failAt === state.liveWrites)
								throw Error("simulated SQL failure");
							const isPage = sql.includes("`catalog_pages`"),
								rows = isPage ? state.pages : state.offers;
							const keys = [...sql.matchAll(/`([^`]+)`=/g)].map((m) => m[1]);
							const fields = Object.fromEntries(
								keys.map((key, index) => [key, params[index]]),
							);
							if (sql.startsWith("INSERT")) {
								const id = Number(fields.id ?? state.nextPage++);
								rows.push({ ...fields, id });
								return [{ insertId: id }, []];
							}
							Object.assign(
								rows.find((row) => Number(row.id) === Number(params.at(-1))) ??
									{},
								fields,
							);
							return [{}, []];
						}
						throw Error(`Unexpected query ${sql}`);
					},
				});
			} catch (error) {
				Object.assign(state, before);
				throw error;
			}
		},
	},
}));

import { validatePackageDraft } from "../domain/packages";
import {
	createCatalogPackageCommand,
	getCatalogPackageCommand,
	previewCatalogPackageCommand,
	publishCatalogPackageCommand,
	saveCatalogPackageCommand,
} from "./packages";

function page(id: number, parent_id: number) {
	return {
		id,
		parent_id,
		caption: `Page ${id}`,
		enabled: "1",
		visible: "1",
		icon_image: 1,
		min_rank: 1,
		club_only: "0",
		vip_only: "0",
		order_num: 1,
		page_layout: "default_3x3",
		includes: "",
		page_text1: "Keep source text",
		page_headline: "header",
		caption_save: "saved",
	};
}
beforeEach(() => {
	state.pages = [page(1, -1), page(2, 1), page(3, -1)];
	state.offers = [
		{
			id: 10,
			page_id: "2",
			catalog_name: "Chair",
			item_ids: "8",
			cost_credits: 3,
			cost_points: 0,
			points_type: 0,
			amount: 1,
			limited_stack: 40,
			limited_sells: 7,
			extradata: "preserve",
			offer_id: 10,
		},
	];
	state.stored = {};
	state.queries = [];
	state.liveWrites = 0;
	state.failAt = 0;
	state.duplicateAt = 0;
	state.nextPage = 200;
	state.nextOffer = 500;
	state.bases = [8];
});
const create = (mode: "update" | "copy" = "update") =>
	createCatalogPackageCommand({
		name: "Release",
		pageIds: [1],
		mode,
		targetParentId: -1,
	});
async function publish(id: string, version: number) {
	const preview = await previewCatalogPackageCommand(id);
	return publishCatalogPackageCommand({
		id,
		version,
		fingerprint: preview.fingerprint,
	});
}
describe("catalog packages", () => {
	it("creates a private descendant snapshot and saves drafts without changing live rows", async () => {
		const p = await create();
		expect(p.baseline.pages.map((p) => p.id)).toEqual([1, 2]);
		expect(p.baseline.offers).toHaveLength(1);
		const saved = await saveCatalogPackageCommand({
			id: p.id,
			version: p.version,
			name: p.name,
			targetParentId: -1,
			draft: {
				...p.draft,
				offers: p.draft.offers.map((o) => ({ ...o, costCredits: 25 })),
			},
		});
		expect(saved.version).toBe(2);
		expect(state.liveWrites).toBe(0);
		expect(state.offers[0].cost_credits).toBe(3);
	});
	it("applies reviewed changes atomically and makes publication retry idempotent", async () => {
		const p = await create();
		p.draft.offers[0].costCredits = 25;
		const saved = await saveCatalogPackageCommand({
			id: p.id,
			version: 1,
			name: p.name,
			targetParentId: -1,
			draft: p.draft,
		});
		const preview = await previewCatalogPackageCommand(p.id);
		expect(preview.changedOffers).toBe(1);
		const input = {
			id: p.id,
			version: saved.version,
			fingerprint: preview.fingerprint,
		};
		const result = await publishCatalogPackageCommand(input);
		expect(result.alreadyPublished).toBe(false);
		expect(state.offers[0].cost_credits).toBe(25);
		const writes = state.liveWrites;
		expect((await publishCatalogPackageCommand(input)).alreadyPublished).toBe(
			true,
		);
		expect(state.liveWrites).toBe(writes);
		expect(
			state.queries.some(
				(q) => q.includes("catalog_pages") && q.includes("FOR UPDATE"),
			),
		).toBe(true);
	});
	it("copies untouched source columns and remaps local page and offer references", async () => {
		state.pages[0].includes = "2";
		const p = await create("copy");
		const result = await publish(p.id, p.version);
		expect(result.pageIds).toEqual([200, 201]);
		expect(state.pages.find((p) => p.id === 200)).toMatchObject({
			parent_id: -1,
			includes: "201",
			page_text1: "Keep source text",
			caption_save: "saved",
		});
		expect(state.pages.find((p) => p.id === 201)?.parent_id).toBe(200);
		expect(state.offers.find((o) => o.id === 500)).toMatchObject({
			page_id: "201",
			offer_id: 500,
			item_ids: "8",
			limited_stack: 40,
			limited_sells: 7,
			extradata: "preserve",
		});
	});
	it("rolls back all category and offer changes plus package status on a SQL failure", async () => {
		const p = await create("copy");
		const preview = await previewCatalogPackageCommand(p.id);
		state.failAt = 2;
		await expect(
			publishCatalogPackageCommand({
				id: p.id,
				version: 1,
				fingerprint: preview.fingerprint,
			}),
		).rejects.toThrow("simulated SQL failure");
		expect(state.pages).toHaveLength(3);
		expect(state.offers).toHaveLength(1);
		expect((await getCatalogPackageCommand(p.id)).status).toBe("draft");
	});
	it.each([
		"field",
		"offerAdded",
		"offerMoved",
		"pageAdded",
		"pageMissing",
		"furnitureMissing",
	])("blocks changed live state: %s", async (change) => {
		const p = await create("copy"),
			preview = await previewCatalogPackageCommand(p.id);
		if (change === "field") state.offers[0].limited_stack = 99;
		if (change === "offerAdded")
			state.offers.push({ ...state.offers[0], id: 11 });
		if (change === "offerMoved") state.offers[0].page_id = "3";
		if (change === "pageAdded") state.pages.push(page(4, 1));
		if (change === "pageMissing")
			state.pages = state.pages.filter((p) => p.id !== 1);
		if (change === "furnitureMissing") state.bases = [];
		await expect(
			publishCatalogPackageCommand({
				id: p.id,
				version: 1,
				fingerprint: preview.fingerprint,
			}),
		).rejects.toThrow();
		expect(state.liveWrites).toBe(0);
	});
	it("requires a fresh preview after destination changes", async () => {
		const p = await createCatalogPackageCommand({
				name: "Copy",
				pageIds: [1],
				mode: "copy",
				targetParentId: 3,
			}),
			preview = await previewCatalogPackageCommand(p.id);
		state.pages[2].min_rank = 99;
		await expect(
			publishCatalogPackageCommand({
				id: p.id,
				version: 1,
				fingerprint: preview.fingerprint,
			}),
		).rejects.toThrow("Refresh");
		expect(state.liveWrites).toBe(0);
	});
	it("rejects stale draft versions and rogue members or furniture references", async () => {
		const p = await create();
		const input = {
			id: p.id,
			version: 1,
			name: p.name,
			targetParentId: -1,
			draft: p.draft,
		};
		await saveCatalogPackageCommand(input);
		await expect(saveCatalogPackageCommand(input)).rejects.toThrow(
			"Package changed",
		);
		expect(() =>
			validatePackageDraft(p.baseline, {
				...p.draft,
				offers: [{ ...p.draft.offers[0], id: 99 }],
			}),
		).toThrow();
		expect(() =>
			validatePackageDraft(p.baseline, {
				...p.draft,
				offers: [{ ...p.draft.offers[0], itemIds: "99" }],
			}),
		).toThrow();
	});
	it("bounds descendants, offers and raw package payload", async () => {
		state.pages = Array.from({ length: 201 }, (_, i) =>
			page(i + 1, i ? 1 : -1),
		);
		await expect(create()).rejects.toThrow("200 categories");
		state.pages = [page(1, -1), page(2, 1)];
		state.offers = Array.from({ length: 501 }, (_, i) => ({
			...state.offers[0],
			id: i + 1,
		}));
		await expect(create()).rejects.toThrow("500 offers");
		state.offers = [];
		state.pages[0].page_text1 = "x".repeat(8_000_001);
		await expect(create()).rejects.toThrow("8 MB");
	});
});

it("retries a rolled-back copy with fresh offer IDs after a concurrent allocation collision", async () => {
	const p = await create("copy");
	state.duplicateAt = 3;
	const result = await publish(p.id, 1);
	expect(result.alreadyPublished).toBe(false);
	expect(state.pages).toHaveLength(5);
	expect(state.offers).toHaveLength(2);
	expect(state.offers.at(-1)?.id).toBe(501);
	expect((await getCatalogPackageCommand(p.id)).status).toBe("published");
});
it("keeps offer membership access immutable in editable drafts", async () => {
	state.offers[0].club_only = "1";
	const p = await create();
	expect(p.baseline.offers[0].clubOnly).toBe("1");
	expect(() =>
		validatePackageDraft(p.baseline, {
			...p.draft,
			offers: [{ ...p.draft.offers[0], clubOnly: "0" }],
		}),
	).toThrow("references");
});
