import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { enqueueEffect, runOperation } from "@/features/operations/server";
import { AdminAuditLog, db, rowsFrom } from "@/lib/db";
import { getOperationContext } from "@/lib/foundation/request-context";
import { CatalogInputError, CatalogNotFound } from "../domain/hierarchy";

/**
 * A deleted offer cannot be restored from a field snapshot: the undo needs the
 * row itself, because a delete takes every column with it and a later create may
 * have reused the id. So the full row is serialised into the audit log at delete
 * time and the restore is a re-insert of that exact row.
 */
export type ItemCatalog = "normal" | "bc";

/**
 * The BC table stores only a reference to the furniture — no price, limit or
 * membership columns exist there. Reading or writing them would be an unknown
 * column error, so the two catalogs get their own column list rather than one
 * that silently drops fields.
 */
const NORMAL_COLUMNS = [
	"id",
	"itemIds",
	"pageId",
	"catalogName",
	"costCredits",
	"costPoints",
	"pointsType",
	"amount",
	"limitedStack",
	"limitedSells",
	"orderNumber",
	"offerId",
	"songId",
	"extradata",
	"haveOffer",
	"clubOnly",
] as const;

const BC_COLUMNS = [
	"id",
	"itemIds",
	"pageId",
	"catalogName",
	"orderNumber",
	"extradata",
] as const;

function columnsFor(catalog: ItemCatalog): readonly string[] {
	return catalog === "bc" ? BC_COLUMNS : NORMAL_COLUMNS;
}

function offersTable(catalog: ItemCatalog) {
	return catalog === "bc" ? "catalog_items_bc" : "catalog_items";
}

function pagesTable(catalog: ItemCatalog) {
	return catalog === "bc" ? "catalog_pages_bc" : "catalog_pages";
}

type DeletedOffer = Record<string, string | number>;

/**
 * `haveOffer` is camelCase in the database itself; every other column is
 * snake_case, so the mapping is written out once rather than derived per call.
 */
const COLUMN_SQL_NAMES: Record<(typeof NORMAL_COLUMNS)[number], string> = {
	id: "id",
	itemIds: "item_ids",
	pageId: "page_id",
	catalogName: "catalog_name",
	costCredits: "cost_credits",
	costPoints: "cost_points",
	pointsType: "points_type",
	amount: "amount",
	limitedStack: "limited_stack",
	limitedSells: "limited_sells",
	orderNumber: "order_number",
	offerId: "offer_id",
	songId: "song_id",
	extradata: "extradata",
	haveOffer: "haveOffer",
	clubOnly: "club_only",
};

function restoreIds(catalog: ItemCatalog) {
	return sql.join(
		columnsFor(catalog).map((key) =>
			sql.identifier(COLUMN_SQL_NAMES[key as keyof typeof COLUMN_SQL_NAMES]),
		),
		sql`, `,
	);
}

function deletedOfferSelect(catalog: ItemCatalog) {
	return sql.join(
		columnsFor(catalog).map(
			(key) =>
				sql`${sql.identifier(COLUMN_SQL_NAMES[key as keyof typeof COLUMN_SQL_NAMES])} AS ${sql.identifier(key)}`,
		),
		sql`, `,
	);
}

/**
 * The catalog is encoded in the action and target columns rather than inferred
 * from the payload, so a restore can never re-insert a BC row into the normal
 * offers table.
 */
function deleteAction(catalog: ItemCatalog) {
	return `${offersTable(catalog)}_delete_restore`;
}

function catalogFromTarget(target: string): ItemCatalog | null {
	if (target === "catalog_items_bc") return "bc";
	if (target === "catalog_items") return "normal";
	return null;
}

function parseOffers(raw: string | null, catalog: ItemCatalog): DeletedOffer[] {
	let value: unknown;
	try {
		value = JSON.parse(raw ?? "null");
	} catch {
		throw Error("unavailable");
	}
	if (!Array.isArray(value) || !value.length) throw Error("unavailable");
	for (const row of value) {
		if (!row || typeof row !== "object" || Array.isArray(row)) {
			throw Error("unavailable");
		}
		const record = row as Record<string, unknown>;
		if (!columnsFor(catalog).every((key) => key in record)) {
			throw Error("unavailable");
		}
	}
	return value as DeletedOffer[];
}

/**
 * Delete offers, keeping enough of each row that the delete can be undone.
 * Returns the audit id the client can restore from.
 */
export async function deleteCatalogItemsCommand(
	ids: number[],
	userId: number,
	requestKey: string = randomUUID(),
	catalog: ItemCatalog = "normal",
) {
	const selection = [...new Set(ids)].sort((a, b) => a - b);
	if (
		!selection.length ||
		selection.length > 500 ||
		selection.some((id) => !Number.isSafeInteger(id) || id < 1)
	)
		throw new CatalogInputError("Invalid selection");
	return runOperation(
		{
			actorId: userId,
			kind: "catalog.items.delete",
			key: requestKey,
			// The catalog is part of the request identity: one delete key replayed
			// against the other catalog is not the same work.
			input: { ids: selection, catalog },
		},
		async (tx, operationId) => {
			const removed = rowsFrom<DeletedOffer>(
				await tx.execute(
					sql`SELECT ${deletedOfferSelect(catalog)} FROM ${sql.raw(offersTable(catalog))} WHERE id IN (${sql.join(
						selection,
						sql`, `,
					)}) ORDER BY id FOR UPDATE`,
				),
			);
			// A row that vanished under us means someone else already deleted it;
			// restoring the rest anyway would leave the caller believing the whole
			// selection succeeded.
			if (removed.length !== selection.length)
				throw new CatalogNotFound(
					"Some selected offers were already deleted. Reload the selection.",
				);
			await tx.execute(
				sql`DELETE FROM ${sql.raw(offersTable(catalog))} WHERE id IN (${sql.join(selection, sql`, `)})`,
			);
			const inserted = await tx.insert(AdminAuditLog).values({
				userId,
				action: deleteAction(catalog),
				target: offersTable(catalog),
				targetId: null,
				details: JSON.stringify(getOperationContext()),
				before: JSON.stringify(removed),
				after: null,
				createdAt: new Date().toISOString(),
			});
			const restoreId = inserted?.[0]?.insertId;
			if (!restoreId) throw Error("Delete could not be recorded for restore");
			await enqueueEffect(tx, operationId, "catalog.refresh");
			await enqueueEffect(tx, operationId, "catalog.export.request");
			return { deleted: removed.length, restoreId: Number(restoreId) };
		},
	);
}

/**
 * Put a deleted selection back. Refuses if any id has since been taken by
 * another offer, so a restore can never overwrite unrelated work.
 */
/**
 * Recent deletions that can still be taken back, newest first. The undo toast
 * is a short window; this is what makes the restore record reachable after it,
 * so a delete noticed ten minutes later is not a hand-editing job.
 */
export interface RestorableDeletion {
	restoreId: number;
	catalog: ItemCatalog;
	offers: number;
	deletedAt: string;
	staffId: number;
}

export async function listRestorableDeletionsCommand(
	limit = 20,
): Promise<RestorableDeletion[]> {
	const capped = Math.min(Math.max(Math.trunc(limit) || 20, 1), 100);
	const rows = rowsFrom<{
		id: number;
		userId: number;
		target: string;
		before: string | null;
		createdAt: string;
	}>(
		await db.execute(
			sql`SELECT id, user_id AS userId, target, before, created_at AS createdAt FROM ${AdminAuditLog} WHERE action IN (${deleteAction("normal")}, ${deleteAction("bc")}) ORDER BY id DESC LIMIT ${capped}`,
		),
	);
	const entries: RestorableDeletion[] = [];
	for (const row of rows) {
		const catalog = catalogFromTarget(String(row.target));
		if (catalog === null) continue;
		try {
			entries.push({
				restoreId: Number(row.id),
				catalog,
				offers: parseOffers(row.before, catalog).length,
				deletedAt: String(row.createdAt ?? ""),
				staffId: Number(row.userId),
			});
		} catch {
			// One corrupt record must not fail the whole list.
		}
	}
	return entries;
}

export async function restoreDeletedCatalogItemsCommand(
	restoreId: number,
	userId: number,
	requestKey: string = randomUUID(),
) {
	if (!Number.isSafeInteger(restoreId) || restoreId < 1)
		throw new CatalogInputError("Invalid restore selection");
	return runOperation(
		{
			actorId: userId,
			kind: "catalog.items.restore",
			key: requestKey,
			input: { restoreId },
		},
		// The lock above is what serialises two restores of the same deletion:
		// the audit row is read FOR UPDATE, so the second one sees it already
		// gone and stops rather than re-inserting.
		async (tx, operationId) => {
			const [entry] = await tx
				.select()
				.from(AdminAuditLog)
				.where(sql`${AdminAuditLog.id}=${restoreId} FOR UPDATE`)
				.limit(1);
			const catalog = entry ? catalogFromTarget(entry.target) : null;
			if (!entry || catalog === null || entry.action !== deleteAction(catalog))
				throw new CatalogNotFound("This deletion can no longer be restored");
			const offers = parseOffers(entry.before, catalog);
			const ids = offers.map((offer) => Number(offer.id));
			const taken = rowsFrom<{ id: number }>(
				await tx.execute(
					sql`SELECT id FROM ${sql.raw(offersTable(catalog))} WHERE id IN (${sql.join(ids, sql`, `)}) ORDER BY id FOR UPDATE`,
				),
			);
			if (taken.length)
				throw new CatalogNotFound(
					"Other offers now use these ids. Restore was not applied.",
				);
			// A restored offer pointing at a deleted category would sell nothing and
			// would not show up under any page, so the restore has to notice that
			// first rather than write an unreachable row.
			const pageIds = [
				...new Set(
					offers.map((offer) => Number(offer.pageId)).filter((id) => id > 0),
				),
			].sort((a, b) => a - b);
			if (pageIds.length) {
				const found = new Set(
					rowsFrom<{ id: number }>(
						await tx.execute(
							sql`SELECT id FROM ${sql.raw(pagesTable(catalog))} WHERE id IN (${sql.join(pageIds, sql`, `)}) ORDER BY id FOR UPDATE`,
						),
					).map((row) => Number(row.id)),
				);
				const missing = pageIds.filter((id) => !found.has(id));
				if (missing.length)
					throw new CatalogNotFound(
						`These categories no longer exist, so the offers would be unreachable: ${missing.join(", ")}. Restore was not applied.`,
					);
			}
			const keys = columnsFor(catalog);
			for (const offer of offers) {
				await tx.execute(
					sql`INSERT INTO ${sql.raw(offersTable(catalog))} (${restoreIds(catalog)}) VALUES (${sql.join(
						keys.map((key) => sql`${offer[key]}`),
						sql`, `,
					)})`,
				);
			}
			// The audit entry has served its purpose once the rows are back.
			await tx
				.delete(AdminAuditLog)
				.where(sql`${AdminAuditLog.id}=${restoreId}`);
			await enqueueEffect(tx, operationId, "catalog.refresh");
			await enqueueEffect(tx, operationId, "catalog.export.request");
			return { restored: offers.length };
		},
	);
}
