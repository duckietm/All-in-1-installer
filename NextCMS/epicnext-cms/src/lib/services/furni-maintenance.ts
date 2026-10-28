import { sql } from "drizzle-orm";
import { db, queryRows, rowsFrom } from "@/lib/db";
import {
	type CatalogOfferRebuildResult,
	type FurniDataReconcileResult,
	readFurniData,
	rebuildCatalogOfferIds,
	reconcileFurniDataWithItemsBase,
	type SpriteIdVerifyResult,
	verifyAndFixSpriteIds,
	withFurniDataLock,
} from "@/lib/services/furni-data";

/**
 * Catalog maintenance toolkit.
 *
 * The Catalog studio (and the raw furnidata import) already keep ids consistent
 * on the happy path, but legacy rows / manual edits can drift. This module
 * exposes safe, transaction-wrapped operations that the admin "Catalog
 * maintenance" page triggers. Every mutating call has a `preview` (count-only)
 * mode and an `apply` mode, and all writes run inside a single InnoDB
 * transaction so a failure rolls back completely.
 */

/** Integer foreign-key columns that store a base id (item_id / sprite_id). */
const INT_COLS: Array<[string, string]> = [
	["items", "item_id"],
	["room_templates_items", "item_id"],
	["catalog_items_limited", "item_id"],
	["crafting_recipes_ingredients", "item_id"],
	["items_crackable", "item_id"],
	["gift_wrappers", "sprite_id"],
	["gift_wrappers", "item_id"],
	["trax_playlist", "item_id"],
	["pet_drinks", "item_id"],
	["pet_foods", "item_id"],
	["pet_items", "item_id"],
	["marketplace_items", "item_id"],
	["calendar_rewards", "item_id"],
	["builders_club_items", "item_id"],
	["youtube_playlists", "item_id"],
	["room_trax_playlist", "item_id"],
	["recycler_prizes", "item_id"],
	["website_event_prizes", "item_id"],
	["website_rare_values", "item_id"],
	["catalog_products", "item_id"],
	["room_trade_log_items", "item_id"],
	["logs_economy", "item_id"],
];

/** String columns that hold a single numeric base id. */
const STR_COLS: Array<[string, string]> = [
	["catalog_items", "item_ids"],
	["catalog_items_bc", "item_ids"],
	["logs_shop_purchases", "item_ids"],
	["catalog_version_offers", "item_ids"],
];

async function query<T>(q: unknown): Promise<T[]> {
	return queryRows<T>(q as never);
}

async function exists(table: string): Promise<boolean> {
	const rows = await query<{ c: number }>(sql`SELECT COUNT(*) c
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table}`);
	return Number(rows[0]?.c ?? 0) > 0;
}

/** Pre-resolve each string column's charset/collation so JOINs never mix them. */
async function loadCollationMap(): Promise<Map<string, [string, string]>> {
	const map = new Map<string, [string, string]>();
	for (const [table, col] of STR_COLS) {
		if (!(await exists(table))) continue;
		const rows = await query<{
			CHARACTER_SET_NAME: string | null;
			COLLATION_NAME: string | null;
		}>(sql`
			SELECT CHARACTER_SET_NAME, COLLATION_NAME
			FROM information_schema.COLUMNS
			WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table} AND COLUMN_NAME = ${col}`);
		const r = rows[0];
		if (r?.CHARACTER_SET_NAME)
			map.set(`${table}.${col}`, [
				r.CHARACTER_SET_NAME,
				r.COLLATION_NAME ?? r.CHARACTER_SET_NAME,
			]);
	}
	return map;
}

/** Convert a numeric expression to CHAR in the column's own charset/collation. */
function numToStr(
	map: Map<string, [string, string]>,
	table: string,
	col: string,
	expr: string,
): string {
	const info = map.get(`${table}.${col}`);
	if (!info) return `CAST(${expr} AS CHAR)`;
	return `CONVERT(${expr}, CHAR CHARACTER SET ${info[0]}) COLLATE ${info[1]}`;
}

export interface FurniHealth {
	itemsBaseTotal: number;
	spriteIdMismatch: number;
	catalogOfferMismatch: number;
	duplicateClassnames: number;
	idMismatchVsFurnidata: number;
	catalogDuplicates: number;
	catalogBcDuplicates: number;
	catalogPageDuplicates: number;
	emulatorIssues: number;
}

/** Read-only snapshot of how far the furniture tables have drifted. */
export async function getFurniHealth(): Promise<FurniHealth> {
	const [ib] = await query<{ c: number }>(
		sql`SELECT COUNT(*) c FROM items_base`,
	);
	const [sp] = await query<{ c: number }>(
		sql`SELECT COUNT(*) c FROM items_base WHERE sprite_id <> id`,
	);
	const [co] = await query<{ c: number }>(
		sql`SELECT COUNT(*) c FROM catalog_items WHERE offer_id <> id`,
	);
	const [dc] = await query<{ c: number }>(sql`
		SELECT COUNT(*) c FROM (
			SELECT item_name FROM items_base GROUP BY item_name HAVING COUNT(*) > 1
		) g`);

	const CAT_DUP_COLS = ["page_id", "item_ids"];
	const BC_DUP_COLS = ["page_id", "item_ids", "catalog_name", "extradata"];
	const catCols = CAT_DUP_COLS.join(",");
	const bcCols = BC_DUP_COLS.join(",");
	const [cd] = await query<{ c: number }>(sql`
		SELECT COUNT(*) c FROM (
			SELECT ${sql.raw(catCols)} FROM catalog_items
			GROUP BY ${sql.raw(catCols)} HAVING COUNT(*) > 1
		) g`);
	const [cdb] = await query<{ c: number }>(sql`
		SELECT COUNT(*) c FROM (
			SELECT ${sql.raw(bcCols)} FROM catalog_items_bc
			GROUP BY ${sql.raw(bcCols)} HAVING COUNT(*) > 1
		) g`);

	const [cpd] = await query<{ c: number }>(sql`
		SELECT COUNT(*) c FROM (
			SELECT caption_save, parent_id FROM catalog_pages
			WHERE caption_save <> ''
			GROUP BY caption_save, parent_id HAVING COUNT(*) > 1
		) g`);

	// ── Emulator-level catalog validation ────────────────────────────
	const emulatorIssues = await countEmulatorIssues();

	const furniData = (await readFurniData()) as Record<
		string,
		{ furnitype?: Array<{ id?: unknown; classname?: unknown }> }
	>;
	const desired = new Map<string, number>();
	for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
		for (const e of furniData[section]?.furnitype ?? []) {
			const cn = typeof e?.classname === "string" ? e.classname : "";
			const id = Number(e?.id);
			if (cn && Number.isFinite(id) && id > 0 && !desired.has(cn)) {
				desired.set(cn, id);
			}
		}
	}
	const rows = await query<{ id: number; item_name: string }>(
		sql`SELECT id, item_name FROM items_base`,
	);
	let idMismatch = 0;
	for (const r of rows) {
		const target = desired.get(r.item_name);
		if (target !== undefined && target !== r.id) idMismatch++;
	}

	return {
		itemsBaseTotal: Number(ib?.c ?? 0),
		spriteIdMismatch: Number(sp?.c ?? 0),
		catalogOfferMismatch: Number(co?.c ?? 0),
		duplicateClassnames: Number(dc?.c ?? 0),
		idMismatchVsFurnidata: idMismatch,
		catalogDuplicates: Number(cd?.c ?? 0),
		catalogBcDuplicates: Number(cdb?.c ?? 0),
		catalogPageDuplicates: Number(cpd?.c ?? 0),
		emulatorIssues,
	};
}

export interface FixSpriteResult extends SpriteIdVerifyResult {}
export interface FixOfferResult extends CatalogOfferRebuildResult {}
export interface ReconcileResult extends FurniDataReconcileResult {}

/** Points-type values the Arcturus emulator accepts for catalog pricing. */
const EMULATOR_POINTS_TYPES = new Set([0, 5]);

export interface EmulatorCatalogIssue {
	type:
		| "points_currency"
		| "negative_cost"
		| "nonpositive_amount"
		| "limited_stack_vs_sells"
		| "missing_page"
		| "missing_item"
		| "duplicate_order"
		| "page_cycle"
		| "sibling_page_order";
	id: number;
	pageId?: number;
	detail: string;
}

/**
 * Scan catalog_items for the same data problems the Arcturus emulator throws
 * on catalog load: unsupported points currency, negative prices, non-positive
 * amount, limited_stack below limited_sells, orphaned page/item references and
 * duplicate sibling order numbers on the same page.
 */
export async function countEmulatorIssues(): Promise<number> {
	const issues = await listEmulatorIssues();
	return issues.length;
}

export async function listEmulatorIssues(): Promise<EmulatorCatalogIssue[]> {
	const items = await queryRows<{
		id: number;
		pageId: number | string;
		itemIds: string;
		costCredits: number;
		costPoints: number;
		pointsType: number;
		amount: number;
		limitedStack: number;
		limitedSells: number;
		orderNumber: number;
	}>(sql`
		SELECT
			ci.id, ci.page_id AS pageId, ci.item_ids AS itemIds,
			ci.cost_credits AS costCredits, ci.cost_points AS costPoints,
			ci.points_type AS pointsType, ci.amount, ci.limited_stack AS limitedStack,
			ci.limited_sells AS limitedSells, ci.order_number AS orderNumber
		FROM catalog_items ci
	`);
	const pages = await queryRows<{
		id: number;
		parentId: number | string;
		orderNum: number;
	}>(
		sql`SELECT id, parent_id AS parentId, order_num AS orderNum FROM catalog_pages`,
	);
	const bases = await queryRows<{ id: number }>(sql`SELECT id FROM items_base`);

	const pageIds = new Set(pages.map((r) => Number(r.id)));
	const baseIds = new Set(bases.map((r) => Number(r.id)));

	const issues: EmulatorCatalogIssue[] = [];
	for (const row of items) {
		const id = Number(row.id);
		const pageId = Number(row.pageId);

		if (!pageIds.has(pageId)) {
			issues.push({
				type: "missing_page",
				id,
				pageId,
				detail: `catalog_items #${id} references offer page ${pageId} which does not exist`,
			});
		}
		for (const part of String(row.itemIds ?? "").split(";")) {
			const baseId = Number(part.trim());
			if (baseId > 0 && !baseIds.has(baseId)) {
				issues.push({
					type: "missing_item",
					id,
					pageId,
					detail: `catalog_items #${id} references item definition ${baseId} which does not exist`,
				});
			}
		}
		if (!EMULATOR_POINTS_TYPES.has(Number(row.pointsType))) {
			issues.push({
				type: "points_currency",
				id,
				pageId,
				detail: `catalog_items #${id} uses unsupported points currency ${row.pointsType}`,
			});
		}
		if (Number(row.costCredits) < 0 || Number(row.costPoints) < 0) {
			issues.push({
				type: "negative_cost",
				id,
				pageId,
				detail: `catalog_items #${id} has negative credits/points cost`,
			});
		}
		if (Number(row.amount) <= 0) {
			issues.push({
				type: "nonpositive_amount",
				id,
				pageId,
				detail: `catalog_items #${id} has amount ${row.amount} (must be positive)`,
			});
		}
		if (Number(row.limitedStack) < Number(row.limitedSells)) {
			issues.push({
				type: "limited_stack_vs_sells",
				id,
				pageId,
				detail: `catalog_items #${id} limited stack ${row.limitedStack} is lower than the live slot count ${row.limitedSells}`,
			});
		}
	}

	// Duplicate sibling order numbers grouped by (page_id, order_number).
	const orderGroups = new Map<string, number[]>();
	const rootOrders = new Map<string, number[]>();
	for (const row of items) {
		const pageId = Number(row.pageId);
		const order = Number(row.orderNumber);
		const key = pageId <= 0 ? `root:${order}` : `${pageId}:${order}`;
		const target = pageId <= 0 ? rootOrders : orderGroups;
		const arr = target.get(key) ?? [];
		arr.push(Number(row.id));
		target.set(key, arr);
	}
	const merged = new Map<string, number[]>();
	for (const [k, v] of orderGroups) merged.set(k, v);
	for (const [k, v] of rootOrders) merged.set(k, v);
	for (const [, ids] of merged) {
		if (ids.length > 1) {
			for (const id of ids) {
				issues.push({
					type: "duplicate_order",
					id,
					detail: `catalog_items #${id} shares an order number with siblings on the same page`,
				});
			}
		}
	}

	// Page hierarchy cycles: a page (or a chain of pages) whose parent chain
	// loops back on itself breaks the catalog tree ("page hierarchy contains a
	// cycle"). Flag every page that is a member of such a cycle.
	const parentOf = new Map<number, number>();
	for (const row of pages) parentOf.set(Number(row.id), Number(row.parentId));
	const inCycle = new Set<number>();
	const walked = new Set<number>();
	for (const row of pages) {
		const start = Number(row.id);
		if (walked.has(start)) continue;
		const path: number[] = [];
		const at = new Map<number, number>();
		let cur = start;
		while (cur !== 0 && !at.has(cur)) {
			at.set(cur, path.length);
			path.push(cur);
			cur = parentOf.get(cur) ?? 0;
		}
		for (const node of path) walked.add(node);
		if (at.has(cur)) {
			for (let i = at.get(cur) ?? path.length; i < path.length; i++)
				inCycle.add(path[i]);
		}
	}
	for (const id of [...inCycle].sort((a, b) => a - b)) {
		issues.push({
			type: "page_cycle",
			id,
			detail: `catalog page #${id} (parent ${parentOf.get(id)}) is part of a parent hierarchy cycle`,
		});
	}

	// Sibling page order: child pages of the same parent must have a unique
	// order_num ("sibling order N is used more than once"). Flag every page
	// whose (parent_id, order_num) is shared with at least one sibling.
	const pageOrderGroups = new Map<string, number[]>();
	for (const row of pages) {
		const parentId = Number(row.parentId);
		const order = Number(row.orderNum);
		const key = `${parentId}:${order}`;
		const arr = pageOrderGroups.get(key) ?? [];
		arr.push(Number(row.id));
		pageOrderGroups.set(key, arr);
	}
	for (const [, ids] of pageOrderGroups) {
		if (ids.length <= 1) continue;
		for (const id of ids) {
			issues.push({
				type: "sibling_page_order",
				id,
				pageId: parentOf.get(id) ?? 0,
				detail: `catalog page #${id} shares order_num with a sibling under the same parent`,
			});
		}
	}

	return issues;
}

export interface FixEmulatorResult {
	fixed: number;
	removed: number;
	detail: string[];
}

/**
 * Fix every emulator-level catalog defect in one transaction:
 *  - unsupported points currency  -> duckets (0)
 *  - negative credits / points    -> 0
 *  - amount <= 0                  -> 1
 *  - limited_stack < limited_sells -> limited_stack = limited_sells
 *  - orphaned page / item refs    -> row deleted
 *  - duplicate sibling order      -> re-numbered sequentially per page
 */
export async function fixEmulatorIssues(): Promise<FixEmulatorResult> {
	const issues = await listEmulatorIssues();
	const detail: string[] = [];
	let fixed = 0;
	let removed = 0;

	await db.transaction(async (tx) => {
		// Rows with a missing page or item reference: the emulator cannot
		// render them and every other validation below is meaningless, so delete.
		const orphanIds = issues
			.filter((i) => i.type === "missing_page" || i.type === "missing_item")
			.map((i) => i.id);
		if (orphanIds.length > 0) {
			await tx.execute(
				sql`DELETE FROM catalog_items_limited WHERE catalog_item_id IN (${sql.join([...new Set(orphanIds)], sql`, `)})`,
			);
			await tx.execute(
				sql`DELETE FROM catalog_items WHERE id IN (${sql.join([...new Set(orphanIds)], sql`, `)})`,
			);
			removed = new Set(orphanIds).size;
			detail.push(
				`Deleted ${removed} offer(s) with missing page/item references`,
			);
		}

		// points currency -> duckets
		const badPoints = issues.filter((i) => i.type === "points_currency");
		if (badPoints.length > 0) {
			await tx.execute(
				sql`UPDATE catalog_items SET points_type = 0 WHERE id IN (${sql.join(
					badPoints.map((i) => i.id),
					sql`, `,
				)})`,
			);
			fixed += badPoints.length;
			detail.push(
				`Reset points currency to duckets on ${badPoints.length} offer(s)`,
			);
		}

		// negative credits / points -> 0
		const negativeCost = issues.filter((i) => i.type === "negative_cost");
		if (negativeCost.length > 0) {
			const ids = negativeCost.map((i) => i.id);
			await tx.execute(
				sql`UPDATE catalog_items SET cost_credits = CASE WHEN cost_credits < 0 THEN 0 ELSE cost_credits END, cost_points = CASE WHEN cost_points < 0 THEN 0 ELSE cost_points END WHERE id IN (${sql.join(ids, sql`, `)})`,
			);
			fixed += ids.length;
			detail.push(`Clamped negative prices to 0 on ${ids.length} offer(s)`);
		}

		// amount <= 0 -> 1
		const badAmount = issues.filter((i) => i.type === "nonpositive_amount");
		if (badAmount.length > 0) {
			await tx.execute(
				sql`UPDATE catalog_items SET amount = 1 WHERE id IN (${sql.join(
					badAmount.map((i) => i.id),
					sql`, `,
				)})`,
			);
			fixed += badAmount.length;
			detail.push(`Set amount to 1 on ${badAmount.length} offer(s)`);
		}

		// limited_stack < limited_sells -> limited_stack = limited_sells
		const limited = issues.filter((i) => i.type === "limited_stack_vs_sells");
		if (limited.length > 0) {
			await tx.execute(
				sql`UPDATE catalog_items SET limited_stack = limited_sells WHERE id IN (${sql.join(
					limited.map((i) => i.id),
					sql`, `,
				)}) AND limited_stack < limited_sells`,
			);
			fixed += limited.length;
			detail.push(
				`Raised limited stack to the sold count on ${limited.length} offer(s)`,
			);
		}

		// duplicate sibling order -> re-number sequentially per page
		const dupOrders = issues.filter((i) => i.type === "duplicate_order");
		if (dupOrders.length > 0) {
			const allRows = rowsFrom<{
				id: number;
				pageId: number | string;
				orderNumber: number;
			}>(
				await tx.execute(sql`
				SELECT id, page_id AS pageId, order_number AS orderNumber
				FROM catalog_items ORDER BY page_id, order_number, id
			`),
			);
			let lastPage: number | null = null;
			let next = 1;
			for (const row of allRows) {
				const page = Number(row.pageId);
				if (page !== lastPage) {
					lastPage = page;
					next = 1;
				}
				const newOrder = next++;
				if (newOrder !== Number(row.orderNumber)) {
					await tx.execute(
						sql`UPDATE catalog_items SET order_number = ${newOrder} WHERE id = ${Number(row.id)}`,
					);
				}
			}
			fixed += dupOrders.length;
			detail.push(`Re-numbered sibling order numbers on affected pages`);
		}

		// Page hierarchy cycles -> detach the highest member of each cycle so
		// the parent chain can never loop back on itself.
		const cyclePages = issues.filter((i) => i.type === "page_cycle");
		if (cyclePages.length > 0) {
			const cycleIds = cyclePages.map((i) => i.id);
			const cycleRows = rowsFrom<{
				id: number | string;
				parentId: number | string;
			}>(
				await tx.execute(sql`
				SELECT id, parent_id AS parentId FROM catalog_pages WHERE id IN (${sql.join(cycleIds, sql`, `)})
			`),
			);
			const parentOf = new Map(
				cycleRows.map((r) => [Number(r.id), Number(r.parentId)]),
			);
			const broken = new Set<number>();
			for (const id of cycleIds) {
				if (broken.has(id)) continue;
				// Walk the cycle's parent chain to collect every member.
				let cur = id;
				const chain = new Set<number>();
				while (cur !== 0 && !chain.has(cur)) {
					chain.add(cur);
					cur = parentOf.get(cur) ?? 0;
				}
				const member = Math.max(...chain);
				await tx.execute(
					sql`UPDATE catalog_pages SET parent_id = 0 WHERE id = ${member}`,
				);
				for (const node of chain) broken.add(node);
			}
			fixed += cyclePages.length;
			detail.push(
				`Detached ${new Set([...broken]).size} page(s) from parent hierarchy cycles`,
			);
		}

		// Sibling page order -> re-number children sequentially under each
		// affected parent, preserving the existing relative order.
		const pageOrderIssues = issues.filter(
			(i) => i.type === "sibling_page_order",
		);
		if (pageOrderIssues.length > 0) {
			const parents = [...new Set(pageOrderIssues.map((i) => i.pageId))];
			for (const parent of parents) {
				const children = rowsFrom<{
					id: number | string;
					orderNum: number;
				}>(
					await tx.execute(sql`
					SELECT id, order_num AS orderNum FROM catalog_pages
					WHERE parent_id = ${String(parent)} ORDER BY order_num, id
				`),
				);
				let next = 1;
				for (const child of children) {
					const newOrder = next++;
					if (newOrder !== Number(child.orderNum)) {
						await tx.execute(
							sql`UPDATE catalog_pages SET order_num = ${newOrder} WHERE id = ${Number(child.id)}`,
						);
					}
				}
			}
			fixed += pageOrderIssues.length;
			detail.push(
				`Re-numbered sibling page order under ${parents.length} parent(s)`,
			);
		}
	});

	return { fixed, removed, detail };
}

/** Fix items_base.sprite_id -> id (only where furnidata agrees). */
export async function fixSpriteIds(): Promise<FixSpriteResult> {
	return verifyAndFixSpriteIds();
}

/** Force catalog_items.offer_id -> id (emulator offer lookup stays correct). */
export async function fixCatalogOffers(): Promise<FixOfferResult> {
	return rebuildCatalogOfferIds();
}

/** Make FurnitureData.json ids/offerids agree with items_base (items_base authoritative). */
export async function reconcileIds(): Promise<ReconcileResult> {
	return reconcileFurniDataWithItemsBase();
}

export interface DedupResult {
	groups: number;
	removed: number;
	remapped: number;
	catalogRemoved: number;
	catalogBcRemoved: number;
	catalogPageRemoved: number;
}

export interface CatalogPageDedupResult {
	groups: number;
	removed: number;
	remapped: number;
}

/**
 * Collapse duplicate catalog_pages that share the same (caption_save, parent_id)
 * into a single survivor so the catalog tree never renders double links. The
 * lowest id wins; its catalog_items (and builder-club items) are moved onto the
 * survivor and any child pages are reparented to it, then the duplicates are
 * deleted. Every write runs inside one transaction.
 */
export async function dedupeCatalogPages(): Promise<CatalogPageDedupResult> {
	const groups = await query<{ caption_save: string; parent_id: number }>(sql`
		SELECT caption_save, parent_id
		FROM catalog_pages
		WHERE caption_save <> ''
		GROUP BY caption_save, parent_id
		HAVING COUNT(*) > 1`);
	if (groups.length === 0) return { groups: 0, removed: 0, remapped: 0 };

	let removed = 0;
	let remapped = 0;
	await withFurniDataLock(async () => {
		await db.transaction(async (tx) => {
			for (const g of groups) {
				const pages = await query<{ id: number }>(sql`
					SELECT id FROM catalog_pages
					WHERE caption_save = ${g.caption_save} AND parent_id = ${g.parent_id}
					ORDER BY id ASC`);
				if (pages.length < 2) continue;
				const [winner, ...losers] = pages.map((p) => p.id);
				for (const loser of losers) {
					const affected =
						rowsFrom<{ affectedRows: number }>(
							await tx.execute(sql`
						UPDATE catalog_items SET page_id = ${winner} WHERE page_id = ${loser}`),
						)[0]?.affectedRows ?? 0;
					remapped += Number(affected);
					if (await exists("catalog_items_bc")) {
						const bciAffected =
							rowsFrom<{ affectedRows: number }>(
								await tx.execute(sql`
							UPDATE catalog_items_bc SET page_id = ${winner} WHERE page_id = ${loser}`),
							)[0]?.affectedRows ?? 0;
						remapped += Number(bciAffected);
					}
					// Keep any child pages by reparenting them onto the survivor.
					await tx.execute(sql`
						UPDATE catalog_pages SET parent_id = ${winner} WHERE parent_id = ${loser}`);
					await tx.execute(sql`DELETE FROM catalog_pages WHERE id = ${loser}`);
					removed++;
				}
			}
		});
	});
	return { groups: groups.length, removed, remapped };
}

/**
 * Remove duplicate items_base rows that share the same item_name (classname).
 * The lowest id in each group is kept; every referencing int/string column is
 * remapped from the duplicate ids onto the keeper id, then the duplicates are
 * deleted. All inside one transaction.
 */
export async function removeDuplicateItemsBase(): Promise<DedupResult> {
	return withFurniDataLock(async () => {
		// Fetch every row whose classname is duplicated (no GROUP_CONCAT, so it
		// stays correct even for very large duplicate groups).
		const dupRows = await query<{ id: number; item_name: string }>(sql`
			SELECT b.id, b.item_name FROM items_base b
			WHERE b.item_name IN (
				SELECT item_name FROM items_base GROUP BY item_name HAVING COUNT(*) > 1
			)
			ORDER BY b.item_name, b.id`);

		const groups = new Map<string, number[]>();
		for (const r of dupRows) {
			const arr = groups.get(r.item_name) ?? [];
			arr.push(r.id);
			groups.set(r.item_name, arr);
		}
		const groupList = [...groups.entries()].map(([item_name, ids]) => ({
			item_name,
			keeper: ids[0],
			ids,
		}));

		const activeInt = (
			await Promise.all(
				INT_COLS.map(async ([t, c]) =>
					(await exists(t)) ? ([t, c] as [string, string]) : null,
				),
			)
		).filter(Boolean) as [string, string][];
		const activeStr = (
			await Promise.all(
				STR_COLS.map(async ([t, c]) =>
					(await exists(t)) ? ([t, c] as [string, string]) : null,
				),
			)
		).filter(Boolean) as [string, string][];

		let removed = 0;
		let remapped = 0;

		await db.transaction(async (tx) => {
			await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
			for (const g of groupList) {
				const ids = g.ids.filter((x) => x !== g.keeper);
				for (const dupId of ids) {
					for (const [table, col] of activeInt) {
						const r = rowsFrom<{ affectedRows: number }>(
							await tx.execute(
								sql`UPDATE ${sql.raw(table)} t SET ${sql.raw(col)} = ${g.keeper} WHERE ${sql.raw(col)} = ${dupId}`,
							),
						)[0];
						remapped += Number(r?.affectedRows ?? 0);
					}
					for (const [table, col] of activeStr) {
						const from = String(dupId);
						const to = String(g.keeper);
						await tx.execute(
							sql.raw(
								`UPDATE ${table} t SET ${col} = TRIM(BOTH ',' FROM REPLACE(CONCAT(',', ${col}, ','), CONCAT(',', '${from}', ','), CONCAT(',', '${to}', ','))) WHERE CONCAT(',', ${col}, ',') LIKE '%,${from},%'`,
							),
						);
					}
					await tx.execute(sql`DELETE FROM items_base WHERE id = ${dupId}`);
					removed++;
				}
			}
			await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
		});

		return {
			groups: groupList.length,
			removed,
			remapped,
			catalogRemoved: 0,
			catalogBcRemoved: 0,
			catalogPageRemoved: 0,
		};
	});
}

/**
 * Remove duplicate rows from a catalog table. Two rows are duplicates when they
 * are the exact same product on the same page (identical page_id, item_ids,
 * catalog_name and every cost/limit/extra flag). The lowest id is kept, the rest
 * deleted. No foreign keys reference catalog_items.id, so this is safe.
 */
async function dedupCatalogTable(table: string): Promise<number> {
	if (!(await exists(table))) return 0;
	const grp =
		table === "catalog_items_bc"
			? ["page_id", "item_ids", "catalog_name", "extradata"]
			: ["page_id", "item_ids"];
	const on = grp.map((c) => `t.${c} <=> d.${c}`).join(" AND ");
	const r = await queryRows<{ affectedRows: number }>(
		sql.raw(
			`DELETE t FROM ${table} t JOIN (SELECT ${grp.join(",")}, MIN(id) AS _keep FROM ${table} GROUP BY ${grp.join(",")} HAVING COUNT(*) > 1) d ON ${on} WHERE t.id <> d._keep`,
		),
	);
	return r[0]?.affectedRows ?? 0;
}

/**
 * Full duplicate cleanup: items_base (by classname) + catalog_pages (by
 * caption_save + parent_id) + catalog_items / catalog_items_bc (by identical
 * product on the same page). The page merge runs before the row dedup so items
 * moved onto the survivor are still de-duplicated within the page afterwards.
 */
export async function removeDuplicates(
	includePages = true,
): Promise<DedupResult> {
	const ib = await removeDuplicateItemsBase();
	const pageDedup = includePages
		? await dedupeCatalogPages()
		: { groups: 0, removed: 0, remapped: 0 };
	const catalogRemoved = await dedupCatalogTable("catalog_items");
	const catalogBcRemoved = await dedupCatalogTable("catalog_items_bc");
	return {
		...ib,
		catalogPageRemoved: pageDedup.removed,
		catalogRemoved,
		catalogBcRemoved,
	};
}

export interface AlignResult {
	moves: number;
	inserted: number;
	skipped: string[];
}

/**
 * Force items_base.id to equal the FurnitureData.json sprite id for every
 * classname (FurnitureData is the source of truth). New classnames are inserted
 * with their furnidata id; existing rows whose id differs are moved via a
 * multi-pass primary-key swap that rewrites every referencing column so no
 * foreign key / shop reference breaks. Mirrors scripts/align-db-ids-with-furnidata.ts.
 */
export async function forceItemsBaseIdsToFurnidata(
	apply: boolean,
): Promise<AlignResult> {
	const furniData = (await readFurniData()) as Record<
		string,
		{ furnitype?: Array<{ id?: unknown; classname?: unknown }> }
	>;

	const all: Array<{ classname: string; id: number }> = [];
	for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
		for (const e of furniData[section]?.furnitype ?? []) {
			const cn = typeof e?.classname === "string" ? e.classname : "";
			const id = Number(e?.id);
			if (cn && Number.isFinite(id) && id > 0) all.push({ classname: cn, id });
		}
	}

	// Global iterative duplicate-id resolution (keep DB occupant, drop losers).
	const desired = new Map<string, number>();
	for (const e of all) {
		if (!desired.has(e.classname)) desired.set(e.classname, e.id);
	}
	const rows = await query<{ id: number; item_name: string }>(
		sql`SELECT id, item_name FROM items_base`,
	);
	const nameById = new Map<number, string>();
	const idByName = new Map<string, number>();
	let maxId = 0;
	for (const r of rows) {
		nameById.set(r.id, r.item_name);
		idByName.set(r.item_name, r.id);
		maxId = Math.max(maxId, r.id);
	}
	for (;;) {
		const claims = new Map<number, string[]>();
		for (const [cn, id] of desired) {
			const arr = claims.get(id) ?? [];
			arr.push(cn);
			claims.set(id, arr);
		}
		let found = false;
		for (const [id, claimants] of [...claims].sort((a, b) => a[0] - b[0])) {
			if (claimants.length < 2) continue;
			const live = claimants.filter((cn) => desired.get(cn) === id);
			if (live.length < 2) continue;
			found = true;
			const dbHolder = nameById.get(id);
			const winner =
				dbHolder !== undefined && live.includes(dbHolder) ? dbHolder : live[0];
			for (const cn of live) if (cn !== winner) desired.delete(cn);
		}
		if (!found) break;
	}

	let fresh = Math.max(maxId, ...desired.values()) + 1000;
	const moves = new Map<number, number>();
	for (const r of rows) {
		const target = desired.get(r.item_name);
		if (target !== undefined && target !== r.id) moves.set(r.id, target);
	}
	const occupied = new Map<number, true>(nameById.keys().map((k) => [k, true]));
	for (;;) {
		const dest = new Map<number, number>();
		for (const t of moves.values()) dest.set(t, (dest.get(t) ?? 0) + 1);
		let changed = false;
		for (const [, target] of moves) {
			if (!occupied.has(target) || moves.has(target)) continue;
			const holder = nameById.get(target);
			if (holder !== undefined && desired.get(holder) === target) continue;
			moves.set(target, fresh++);
			changed = true;
			break;
		}
		if (!changed) break;
	}
	for (;;) {
		let changed = false;
		for (const [oldId, target] of moves) {
			if (occupied.has(target) || moves.has(target)) continue;
			const holder = nameById.get(target);
			if (holder !== undefined && desired.get(holder) === target) {
				moves.delete(oldId);
				changed = true;
				break;
			}
		}
		if (!changed) break;
	}

	if (!apply) {
		return { moves: moves.size, inserted: 0, skipped: [] };
	}

	const activeInt = (
		await Promise.all(
			INT_COLS.map(async ([t, c]) =>
				(await exists(t)) ? ([t, c] as [string, string]) : null,
			),
		)
	).filter(Boolean) as [string, string][];
	const activeStr = (
		await Promise.all(
			STR_COLS.map(async ([t, c]) =>
				(await exists(t)) ? ([t, c] as [string, string]) : null,
			),
		)
	).filter(Boolean) as [string, string][];
	const collation = await loadCollationMap();

	await withFurniDataLock(async () => {
		await db.transaction(async (tx) => {
			await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
			await tx.execute(sql`DROP TEMPORARY TABLE IF EXISTS _mm_id_map`);
			await tx.execute(sql`CREATE TEMPORARY TABLE _mm_id_map (
				old_id INT PRIMARY KEY, new_id INT NOT NULL, UNIQUE KEY uniq_new (new_id)
			) ENGINE=InnoDB`);

			const occupiedIds = new Map<number, true>(
				nameById.keys().map((k) => [k, true]),
			);
			const pending = new Map(moves);
			let scratch = fresh;
			const applyPass = async (pairs: Array<[number, number]>) => {
				if (pairs.length === 0) return;
				await tx.execute(sql`TRUNCATE TABLE _mm_id_map`);
				for (let i = 0; i < pairs.length; i += 500) {
					const chunk = pairs.slice(i, i + 500);
					await tx.execute(
						sql`INSERT INTO _mm_id_map (old_id, new_id) VALUES ${sql.join(
							chunk.map(([o, nw]) => sql`(${o}, ${nw})`),
							sql`, `,
						)}`,
					);
				}
				await tx.execute(
					sql`UPDATE items_base b JOIN _mm_id_map m ON b.id = m.old_id SET b.id = m.new_id`,
				);
				for (const [table, col] of activeInt) {
					await tx.execute(
						sql`UPDATE ${sql.raw(table)} t JOIN _mm_id_map m ON t.${sql.raw(col)} = m.old_id SET t.${sql.raw(col)} = m.new_id`,
					);
				}
				for (const [table, col] of activeStr) {
					await tx.execute(
						sql`UPDATE ${sql.raw(table)} t JOIN _mm_id_map m ON t.${sql.raw(col)} = ${sql.raw(numToStr(collation, table, col, "m.old_id"))} SET t.${sql.raw(col)} = CAST(m.new_id AS CHAR)`,
					);
				}
				for (const [o, nw] of pairs) {
					occupiedIds.delete(o);
					occupiedIds.set(nw, true);
				}
			};

			while (pending.size > 0) {
				const safe: Array<[number, number]> = [];
				for (const [oldId, target] of pending) {
					if (!occupiedIds.has(target)) safe.push([oldId, target]);
				}
				if (safe.length === 0) {
					const oldest = Math.min(...pending.keys());
					const target = pending.get(oldest);
					if (target === undefined) break;
					pending.delete(oldest);
					await applyPass([[oldest, scratch]]);
					pending.set(scratch, target);
					scratch++;
					continue;
				}
				await applyPass(safe);
				for (const [oldId] of safe) pending.delete(oldId);
			}

			await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
			await tx.execute(sql`DROP TEMPORARY TABLE IF EXISTS _mm_id_map`);
		});
	});

	// Insert missing classnames with their exact furnidata id.
	let inserted = 0;
	const skipped: string[] = [];
	const currentIds = new Set(
		(await query<{ id: number }>(sql`SELECT id FROM items_base`)).map(
			(r) => r.id,
		),
	);
	for (const [cn, id] of desired) {
		if (idByName.has(cn)) continue;
		if (currentIds.has(id)) {
			skipped.push(`${cn} (id ${id} occupied)`);
			continue;
		}
		await db.execute(
			sql`INSERT INTO items_base (id, item_name, sprite_id) VALUES (${id}, ${cn}, ${id})`,
		);
		currentIds.add(id);
		inserted++;
	}

	await db.execute(
		sql`UPDATE items_base SET sprite_id = id WHERE sprite_id <> id`,
	);

	return { moves: moves.size, inserted, skipped };
}

export interface FixAllResult {
	healthBefore: FurniHealth;
	sprite: FixSpriteResult;
	offers: FixOfferResult;
	reconcile: ReconcileResult;
	dedup: DedupResult;
	align: AlignResult;
	healthAfter: FurniHealth;
}

/** Run every repair in a sensible order, then return before/after health. */
export async function fixEverything(
	opts: { dedupePages?: boolean } = {},
): Promise<FixAllResult> {
	const healthBefore = await getFurniHealth();
	const sprite = await fixSpriteIds();
	const offers = await fixCatalogOffers();
	const reconcile = await reconcileIds();
	const dedup = await removeDuplicates(opts.dedupePages ?? true);
	const align = await forceItemsBaseIdsToFurnidata(true);
	const healthAfter = await getFurniHealth();
	return { healthBefore, sprite, offers, reconcile, dedup, align, healthAfter };
}
