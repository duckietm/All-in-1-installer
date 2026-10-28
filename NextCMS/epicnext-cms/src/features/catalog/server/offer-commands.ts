import "server-only";
import { getTableColumns, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { historySnapshot, recordHistory } from "@/features/history/server";
import {
	CatalogItems,
	CatalogItemsBc,
	db,
	ItemsBase,
	rowsFrom,
} from "@/lib/db";
import { CatalogInputError } from "../domain/hierarchy";
import {
	distinctOfferIds,
	furniturePatchSchema,
	itemIds,
	offerIdSchema,
	offerInteger,
	offerPatchSchema,
	parseFurnitureIds,
} from "../domain/offer-input";

type OfferKind = "normal" | "bc";
function offerTable(kind: OfferKind) {
	if (kind !== "normal" && kind !== "bc") throw Error("Invalid catalog type");
	return kind === "bc" ? CatalogItemsBc : CatalogItems;
}
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type UpdateOfferInput = {
	id: number;
	catalogFields: Record<string, unknown>;
	baseItem?: { id: number; fields: Record<string, unknown> };
};
type OfferRow = {
	id: number;
	pageId: number | string;
	itemIds: string;
	limitedStack?: number | string;
	limitedSells?: number | string;
};
async function lockedOffers(
	tx: Transaction,
	ids: number[],
	kind: OfferKind = "normal",
): Promise<OfferRow[]> {
	const offers = rowsFrom<OfferRow>(
		await tx.execute(
			sql`SELECT id, page_id AS pageId, item_ids AS itemIds, limited_stack AS limitedStack, limited_sells AS limitedSells FROM ${offerTable(kind)} WHERE id IN (${sql.join(
				[...ids].sort((a, b) => a - b),
				sql`, `,
			)}) ORDER BY id FOR UPDATE`,
		),
	);
	if (
		offers.length !== ids.length ||
		ids.some((id) => !offers.some((offer) => Number(offer.id) === id))
	)
		throw Error("Catalog item not found");
	return offers;
}
async function lockPage(
	tx: Transaction,
	id: number,
	kind: OfferKind = "normal",
) {
	offerTable(kind);
	if (
		!rowsFrom<{ id: number }>(
			await tx.execute(
				sql`SELECT id FROM ${sql.identifier(kind === "bc" ? "catalog_pages_bc" : "catalog_pages")} WHERE id=${id} FOR UPDATE`,
			),
		).some((row) => Number(row.id) === id)
	)
		throw Error("Catalog page not found");
}
async function lockFurniture(tx: Transaction, ids: number[]) {
	const unique = [...new Set(ids)].sort((a, b) => a - b);
	const found = new Set(
		rowsFrom<{ id: number }>(
			await tx.execute(
				sql`SELECT id FROM items_base WHERE id IN (${sql.join(unique, sql`, `)}) ORDER BY id FOR UPDATE`,
			),
		).map((row) => Number(row.id)),
	);
	if (unique.some((id) => !found.has(id)))
		throw Error("Furniture reference not found");
}
function assignments(
	table: typeof CatalogItems | typeof CatalogItemsBc | typeof ItemsBase,
	fields: Record<string, unknown>,
): SQL[] {
	const columns = getTableColumns(table);
	return Object.entries(fields)
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => {
			const column = columns[key as keyof typeof columns];
			// SQL string parameters work with both deployed page_id column types.
			return sql`${sql.identifier(column.name)}=${key === "pageId" ? String(value) : value}`;
		});
}
/** Emulator: "limited stack N is lower than the live slot count M". */
function assertLimitedStackOk(limitedStack: number, limitedSells: number) {
	if (limitedStack < limitedSells)
		throw new CatalogInputError(
			`Limited stack (${limitedStack}) is lower than the number already sold (${limitedSells})`,
		);
}

/** Emulator: "sibling order N is used more than once". */
async function assertOrderUnique(
	tx: Transaction,
	pageId: string | number,
	orderNumber: number,
	excludeId: number,
) {
	if (
		rowsFrom<unknown>(
			await tx.execute(
				sql`SELECT id FROM catalog_items WHERE page_id = ${String(pageId)} AND order_number = ${orderNumber} AND id != ${excludeId} LIMIT 1`,
			),
		).length > 0
	)
		throw new CatalogInputError(
			`Order number ${orderNumber} is already used by another offer on this page`,
		);
}

export async function updateOfferCommand(
	input: UpdateOfferInput,
	userId?: number,
) {
	offerIdSchema.parse(input.id);
	const fields = offerPatchSchema.parse(input.catalogFields);
	const baseFields = input.baseItem
		? furniturePatchSchema.parse(input.baseItem.fields)
		: {};
	if (input.baseItem) offerIdSchema.parse(input.baseItem.id);
	if (
		!Object.values(fields).some((value) => value !== undefined) &&
		!Object.values(baseFields).some((value) => value !== undefined)
	)
		throw Error("No valid fields to update");
	return db.transaction(async (tx) => {
		// Page locks precede offer locks, matching category deletion's lock order.
		if (fields.pageId !== undefined) await lockPage(tx, fields.pageId);
		const [offer] = await lockedOffers(tx, [input.id]);
		const before = userId
			? await historySnapshot(tx, "prices", input.id)
			: null;
		if (input.baseItem) {
			const currentIds = String(offer.itemIds).split(";").map(Number);
			const nextIds =
				fields.itemIds === undefined
					? currentIds
					: parseFurnitureIds(fields.itemIds);
			if (
				!currentIds.includes(input.baseItem.id) ||
				!nextIds.includes(input.baseItem.id)
			)
				throw Error("Shared furniture must belong to the catalog offer");
		}
		const references =
			fields.itemIds === undefined ? [] : parseFurnitureIds(fields.itemIds);
		if (input.baseItem) references.push(input.baseItem.id);
		if (references.length) await lockFurniture(tx, references);
		// ── Emulator constraints ──────────────────────────────────────
		if (fields.orderNumber !== undefined || fields.pageId !== undefined) {
			const targetPageId = fields.pageId ?? offer.pageId;
			const targetOrder = fields.orderNumber ?? 0;
			if (fields.orderNumber !== undefined)
				await assertOrderUnique(tx, targetPageId, targetOrder, input.id);
		}
		if (
			fields.limitedStack !== undefined ||
			fields.limitedSells !== undefined
		) {
			const row = rowsFrom<{ limitedStack: number; limitedSells: number }>(
				await tx.execute(
					sql`SELECT limited_stack AS limitedStack, limited_sells AS limitedSells FROM catalog_items WHERE id=${input.id}`,
				),
			)[0];
			if (row) {
				const stack = fields.limitedStack ?? Number(row.limitedStack);
				const sells = fields.limitedSells ?? Number(row.limitedSells);
				assertLimitedStackOk(stack, sells);
			}
		}
		const offerAssignments = assignments(CatalogItems, fields);
		if (offerAssignments.length)
			await tx.execute(
				sql`UPDATE ${CatalogItems} SET ${sql.join(offerAssignments, sql`, `)} WHERE id=${input.id}`,
			);
		const baseAssignments = assignments(ItemsBase, baseFields);
		if (input.baseItem && baseAssignments.length)
			await tx.execute(
				sql`UPDATE ${ItemsBase} SET ${sql.join(baseAssignments, sql`, `)} WHERE id=${input.baseItem.id}`,
			);
		if (before && userId)
			await recordHistory(tx, "prices", input.id, userId, before);
	});
}
/**
 * Many offer patches in ONE transaction: the inline table editor's "Save All"
 * used to issue a transaction + lock + RCON refresh + audit row per item, which
 * took tens of seconds on a page with hundreds of edited rows. Lock ordering
 * matches {@link updateOfferCommand}: pages → offers → furniture. A failing row
 * aborts the whole batch (full rollback) rather than leaving a half-applied save.
 */
export async function bulkUpdateOffersCommand(
	updates: UpdateOfferInput[],
	userId?: number,
) {
	if (!updates.length) throw Error("No valid fields to update");
	if (updates.length > 500) throw Error("Max 500 items per bulk update");
	const parsed = updates.map((input) => {
		offerIdSchema.parse(input.id);
		const fields = offerPatchSchema.parse(input.catalogFields);
		const baseFields = input.baseItem
			? furniturePatchSchema.parse(input.baseItem.fields)
			: {};
		if (!Object.values(fields).some((value) => value !== undefined))
			throw Error("No valid fields to update");
		return { input, fields, baseFields };
	});

	const offerIds = distinctOfferIds(parsed.map((row) => row.input.id));
	const furnitureIds: number[] = [];
	for (const row of parsed) {
		if (row.fields.itemIds !== undefined)
			furnitureIds.push(...parseFurnitureIds(row.fields.itemIds));
		if (row.input.baseItem) furnitureIds.push(row.input.baseItem.id);
	}

	return db.transaction(async (tx) => {
		for (const pageId of new Set(
			parsed.map((row) => row.fields.pageId).filter((id) => id !== undefined),
		))
			await lockPage(tx, pageId as number);
		const offers = await lockedOffers(tx, offerIds);
		const offerById = new Map(offers.map((offer) => [Number(offer.id), offer]));
		if (furnitureIds.length) await lockFurniture(tx, furnitureIds);

		const beforeById = new Map<
			number,
			Awaited<ReturnType<typeof historySnapshot>>
		>();
		if (userId)
			for (const id of offerIds)
				beforeById.set(id, await historySnapshot(tx, "prices", id));

		for (const row of parsed) {
			const offer = offerById.get(row.input.id);
			if (!offer) throw Error("Catalog item not found");
			if (row.input.baseItem) {
				const currentIds = String(offer.itemIds).split(";").map(Number);
				const nextIds =
					row.fields.itemIds === undefined
						? currentIds
						: parseFurnitureIds(row.fields.itemIds);
				if (
					!currentIds.includes(row.input.baseItem.id) ||
					!nextIds.includes(row.input.baseItem.id)
				)
					throw Error("Shared furniture must belong to the catalog offer");
			}
			if (
				row.fields.orderNumber !== undefined ||
				row.fields.pageId !== undefined
			) {
				const targetPageId = row.fields.pageId ?? offer.pageId;
				if (row.fields.orderNumber !== undefined)
					await assertOrderUnique(
						tx,
						targetPageId,
						row.fields.orderNumber,
						row.input.id,
					);
			}
			if (
				row.fields.limitedStack !== undefined ||
				row.fields.limitedSells !== undefined
			) {
				const stack = row.fields.limitedStack ?? 0;
				const sells = row.fields.limitedSells ?? 0;
				const resolvedStack =
					row.fields.limitedStack !== undefined
						? stack
						: Number(offer.limitedStack ?? 0);
				const resolvedSells =
					row.fields.limitedSells !== undefined
						? sells
						: Number(offer.limitedSells ?? 0);
				assertLimitedStackOk(resolvedStack, resolvedSells);
			}
			const offerAssignments = assignments(CatalogItems, row.fields);
			if (offerAssignments.length)
				await tx.execute(
					sql`UPDATE ${CatalogItems} SET ${sql.join(offerAssignments, sql`, `)} WHERE id=${row.input.id}`,
				);
			const baseAssignments = assignments(ItemsBase, row.baseFields);
			if (row.input.baseItem && baseAssignments.length)
				await tx.execute(
					sql`UPDATE ${ItemsBase} SET ${sql.join(baseAssignments, sql`, `)} WHERE id=${row.input.baseItem.id}`,
				);
		}
		if (userId)
			for (const id of offerIds) {
				const before = beforeById.get(id);
				if (before) await recordHistory(tx, "prices", id, userId, before);
			}
	});
}

export async function reorderOffersCommand(
	orders: Array<{ id: number; orderNumber: number }>,
) {
	const ids = distinctOfferIds(orders.map((row) => row.id));
	for (const row of orders) offerInteger.parse(row.orderNumber);
	if (!ids.length) return;
	return db.transaction(async (tx) => {
		const offers = await lockedOffers(tx, ids);
		// Validate uniqueness of the new order numbers within each page.
		const pageId = offers[0]?.pageId;
		if (pageId !== undefined) {
			const nums = orders.map((r) => r.orderNumber);
			if (new Set(nums).size !== nums.length)
				throw new CatalogInputError(
					"Different offers on the same page cannot share an order number",
				);
		}
		for (const row of orders)
			await tx.execute(
				sql`UPDATE ${CatalogItems} SET order_number=${row.orderNumber} WHERE id=${row.id}`,
			);
	});
}
export async function moveOffersCommand(ids: number[], targetPageId: number) {
	return moveOffersToPage(ids, targetPageId, "normal");
}

/** BC offers move between BC categories; the lock and the write have to agree. */
export async function moveBcOffersCommand(ids: number[], targetPageId: number) {
	return moveOffersToPage(ids, targetPageId, "bc");
}

async function moveOffersToPage(
	ids: number[],
	targetPageId: number,
	kind: OfferKind,
) {
	distinctOfferIds(ids);
	offerIdSchema.parse(targetPageId);
	if (!ids.length) return;
	const table = offerTable(kind);
	return db.transaction(async (tx) => {
		await lockPage(tx, targetPageId, kind);
		await lockedOffers(tx, ids, kind);
		await tx.execute(
			sql`UPDATE ${table} SET page_id=${String(targetPageId)} WHERE id IN (${sql.join(ids, sql`, `)})`,
		);
	});
}

/** Same as the normal reorder, against the BC offers table. */
export async function reorderBcOffersCommand(
	orders: Array<{ id: number; orderNumber: number }>,
) {
	const ids = distinctOfferIds(orders.map((row) => row.id));
	for (const row of orders) offerInteger.parse(row.orderNumber);
	if (!ids.length) return;
	return db.transaction(async (tx) => {
		const offers = await lockedOffers(tx, ids, "bc");
		const pageId = offers[0]?.pageId;
		if (pageId !== undefined) {
			const nums = orders.map((r) => r.orderNumber);
			if (new Set(nums).size !== nums.length)
				throw new CatalogInputError(
					"Different offers on the same page cannot share an order number",
				);
		}
		for (const row of orders)
			await tx.execute(
				sql`UPDATE ${CatalogItemsBc} SET order_number=${row.orderNumber} WHERE id=${row.id}`,
			);
	});
}

/** Call the allocator before entering this command; only the insert uses its transaction. */
export async function createOfferCommand<T>(
	kind: OfferKind,
	references: { pageId: number; itemIds: string },
	insert: (tx: Transaction) => Promise<T>,
): Promise<T> {
	offerTable(kind);
	offerIdSchema.parse(references.pageId);
	const ids = parseFurnitureIds(references.itemIds);
	return db.transaction(async (tx) => {
		await lockPage(tx, references.pageId, kind);
		await lockFurniture(tx, ids);
		return insert(tx);
	});
}
// BC deliberately has no currencies, amount, LTD values or shared-furniture mutation.
const bcOfferPatchSchema = z.object({
	pageId: offerIdSchema.optional(),
	itemIds: itemIds.optional(),
	catalogName: z.string().max(100).optional(),
	orderNumber: offerInteger.optional(),
	extradata: z.string().max(500).optional(),
});
export async function updateBcOfferCommand(
	id: number,
	input: Record<string, unknown>,
) {
	offerIdSchema.parse(id);
	const fields = bcOfferPatchSchema.parse(input);
	const updates = assignments(CatalogItemsBc, fields);
	if (!updates.length) throw Error("No valid fields to update");
	return db.transaction(async (tx) => {
		if (fields.pageId !== undefined) await lockPage(tx, fields.pageId, "bc");
		await lockedOffers(tx, [id], "bc");
		if (fields.itemIds !== undefined)
			await lockFurniture(tx, parseFurnitureIds(fields.itemIds));
		await tx.execute(
			sql`UPDATE ${CatalogItemsBc} SET ${sql.join(updates, sql`, `)} WHERE id=${id}`,
		);
	});
}
export async function createBcOfferCommand(
	input: Record<string, unknown>,
): Promise<number> {
	const fields = bcOfferPatchSchema.required().parse(input);
	return createOfferCommand("bc", fields, async (tx) => {
		const [result] = await tx.execute(
			sql`INSERT INTO ${CatalogItemsBc} SET ${sql.join(assignments(CatalogItemsBc, fields), sql`, `)}`,
		);
		const id = Number(result.insertId);
		offerIdSchema.parse(id);
		return id;
	});
}
