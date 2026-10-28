import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
	applyHistory,
	lockOfferHistoryPages,
	readHistory,
	recordHistory,
} from "@/features/history/server";
import { enqueueEffect, runOperation } from "@/features/operations/server";
import { db, queryRows, rowsFrom } from "@/lib/db";
import {
	type BulkOfferInput,
	type BulkOfferPreview,
	type BulkOfferValues,
	bulkOfferInputSchema,
	projectBulkOffer,
} from "../domain/bulk-offers";
import {
	CatalogConflict,
	CatalogInputError,
	CatalogNotFound,
} from "../domain/hierarchy";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type BulkCatalogKind = "normal" | "bc";

/**
 * `catalog_items_bc` stores only a reference to the furniture: there are no
 * cost, points, currency or offer_id columns on it at all. So BC bulk editing is
 * a category move and nothing else — the other fields are refused here rather
 * than reaching the database as an unknown-column error.
 */
const BC_FIELD_LABELS: Record<string, string> = {
	costCredits: "price",
	costPoints: "points",
	pointsType: "currency",
};

function assertEditableFields(input: BulkOfferInput, kind: BulkCatalogKind) {
	if (kind !== "bc") return;
	const refused = Object.keys(input.changes).filter(
		(key) => BC_FIELD_LABELS[key] !== undefined,
	);
	if (refused.length)
		throw new CatalogInputError(
			`A Builder Club offer has no ${refused.map((key) => BC_FIELD_LABELS[key]).join(" or ")}. It can only be moved to another category.`,
		);
}

/**
 * The BC catalog has the same offer columns under a second table, so bulk
 * editing is a table choice rather than a second code path. Only normal offers
 * carry `offer_id`, which is why the undo history kind stays single-mode.
 */
function offerTable(kind: BulkCatalogKind) {
	return sql.identifier(kind === "bc" ? "catalog_items_bc" : "catalog_items");
}
function pageTable(kind: BulkCatalogKind) {
	return sql.identifier(kind === "bc" ? "catalog_pages_bc" : "catalog_pages");
}

type OfferRow = BulkOfferValues & { id: number; catalogName: string };
async function readOffers(
	tx: Tx,
	ids: number[],
	kind: BulkCatalogKind,
	lock = false,
): Promise<OfferRow[]> {
	const offers = rowsFrom<OfferRow>(
		await tx.execute(
			sql`SELECT id, catalog_name AS catalogName, page_id AS pageId ${
				kind === "bc"
					? sql`, 0 AS costCredits, 0 AS costPoints, 0 AS pointsType`
					: sql`, cost_credits AS costCredits, cost_points AS costPoints, points_type AS pointsType`
			} FROM ${offerTable(kind)} WHERE id IN (${sql.join(ids, sql`, `)}) ORDER BY id ${lock ? sql`FOR UPDATE` : sql``}`,
		),
	).map((row) => ({
		...row,
		id: Number(row.id),
		pageId: Number(row.pageId),
		costCredits: Number(row.costCredits),
		costPoints: Number(row.costPoints),
		pointsType: Number(row.pointsType),
	}));
	if (
		offers.length !== ids.length ||
		ids.some((id) => !offers.some((row) => row.id === id))
	)
		throw new CatalogNotFound(
			"Selected catalog offer not found. Reload the selection.",
		);
	return offers.sort((a, b) => a.id - b.id);
}
async function readPages(
	tx: Tx,
	offers: OfferRow[],
	input: BulkOfferInput,
	kind: BulkCatalogKind,
	lock = false,
) {
	const ids = [
		...new Set([
			...offers.map((row) => row.pageId),
			...(input.changes.pageId ? [input.changes.pageId] : []),
		]),
	].sort((a, b) => a - b);
	if (ids.some((id) => !Number.isInteger(id) || id <= 0))
		throw new CatalogInputError("An offer has an invalid category reference");
	const pages = rowsFrom<{ id: number; caption: string }>(
		await tx.execute(
			sql`SELECT id, caption FROM ${pageTable(kind)} WHERE id IN (${sql.join(ids, sql`, `)}) ORDER BY id ${lock ? sql`FOR UPDATE` : sql``}`,
		),
	)
		.filter((row) => ids.includes(Number(row.id)))
		.map((row) => ({ id: Number(row.id), caption: row.caption }))
		.sort((a, b) => a.id - b.id);
	if (pages.length !== ids.length)
		throw new CatalogNotFound("Source or destination category not found");
	return pages;
}
function preview(
	input: BulkOfferInput,
	offers: OfferRow[],
	pages: BulkOfferPreview["pages"],
): BulkOfferPreview {
	const rows = offers.map(({ id, catalogName, ...before }) => ({
		id,
		catalogName,
		before,
		after: projectBulkOffer(before, input.changes),
	}));
	const changedCount = rows.filter((row) =>
		Object.keys(input.changes).some(
			(key) =>
				row.before[key as keyof BulkOfferValues] !==
				row.after[key as keyof BulkOfferValues],
		),
	).length;
	const fingerprint = createHash("sha256")
		.update(
			JSON.stringify({
				input: { ...input, ids: [...input.ids].sort((a, b) => a - b) },
				rows,
				pages,
			}),
		)
		.digest("hex");
	return { rows, pages, changedCount, fingerprint };
}
export async function previewBulkOffersCommand(
	value: BulkOfferInput,
	kind: BulkCatalogKind = "normal",
): Promise<BulkOfferPreview> {
	const input = bulkOfferInputSchema.parse(value);
	assertEditableFields(input, kind);
	return db.transaction(async (tx) => {
		const offers = await readOffers(tx, input.ids, kind);
		return preview(input, offers, await readPages(tx, offers, input, kind));
	});
}
export async function applyBulkOffersCommand(
	value: BulkOfferInput,
	fingerprint: string,
	userId?: number,
	requestKey: string = randomUUID(),
	kind: BulkCatalogKind = "normal",
) {
	const input = bulkOfferInputSchema.parse(value);
	assertEditableFields(input, kind);
	if (!/^[a-f0-9]{64}$/.test(fingerprint))
		throw new CatalogInputError("A valid preview is required");
	const work = async (tx: Tx, operationId?: string) => {
		// Read references, then lock pages before offers to match category structural commands.
		const initial = await readOffers(tx, input.ids, kind);
		const pages = await readPages(tx, initial, input, kind, true);
		const offers = await readOffers(tx, input.ids, kind, true);
		if (offers.some((row) => !pages.some((page) => page.id === row.pageId)))
			throw new CatalogConflict("The selection changed. Refresh the preview.");
		const result = preview(input, offers, pages);
		if (result.fingerprint !== fingerprint)
			throw new CatalogConflict(
				"The selection or destination changed. Refresh the preview before applying.",
			);
		const columns = {
			pageId: "page_id",
			costCredits: "cost_credits",
			costPoints: "cost_points",
			pointsType: "points_type",
		};
		const historyIds: number[] = [];
		for (const row of result.rows) {
			const changes = (
				Object.keys(input.changes) as Array<keyof BulkOfferValues>
			).filter(
				(key) =>
					// `assertEditableFields` already refused these, so a BC update
					// only ever writes page_id.
					(kind !== "bc" || key === "pageId") &&
					row.before[key] !== row.after[key],
			);
			if (!changes.length) continue;
			await tx.execute(
				sql`UPDATE ${offerTable(kind)} SET ${sql.join(
					changes.map(
						(key) =>
							sql`${sql.identifier(columns[key])}=${key === "pageId" ? String(row.after[key]) : row.after[key]}`,
					),
					sql`, `,
				)} WHERE id=${row.id}`,
			);
			if (userId) {
				const historyId = await recordHistory(
					tx,
					"catalog_offer",
					row.id,
					userId,
					{
						...row.before,
						pageId: String(row.before.pageId),
					},
				);
				if (!historyId) throw Error("History entry could not be recorded");
				historyIds.push(historyId);
			}
		}
		if (operationId && result.changedCount > 0) {
			await enqueueEffect(tx, operationId, "catalog.refresh");
			await enqueueEffect(tx, operationId, "catalog.export.request");
		}
		return { changedCount: result.changedCount, historyIds };
	};
	return userId
		? runOperation(
				{
					actorId: userId,
					kind: "catalog.bulk.apply",
					key: requestKey,
					input: {
						...input,
						ids: [...input.ids].sort((a, b) => a - b),
						fingerprint,
						// The catalog is part of the identity of this request: a replay
						// with the same key against the other catalog must not be
						// treated as the same work.
						catalog: kind,
					},
				},
				work,
			)
		: db.transaction((tx) => work(tx));
}

export async function listBulkOfferDestinationsCommand(
	kind: BulkCatalogKind = "normal",
) {
	const pages = (
		await queryRows<{ id: number; caption: string }>(
			sql`SELECT id, caption FROM ${pageTable(kind)} WHERE id > 0 ORDER BY caption, id LIMIT 5001`,
		)
	).map((row) => ({ id: Number(row.id), caption: row.caption }));
	if (pages.length > 5000)
		throw new CatalogInputError(
			"The catalog has more than 5000 categories. Use bulk editing from a category instead.",
		);
	return { pages };
}

export async function undoBulkOffersCommand(
	historyIds: number[],
	userId: number,
	requestKey: string = randomUUID(),
) {
	if (
		!Array.isArray(historyIds) ||
		!historyIds.length ||
		historyIds.length > 500 ||
		new Set(historyIds).size !== historyIds.length ||
		historyIds.some((id) => !Number.isSafeInteger(id) || id < 1)
	)
		throw new CatalogInputError("Invalid undo selection");
	return runOperation(
		{
			actorId: userId,
			kind: "catalog.bulk.undo",
			key: requestKey,
			input: { historyIds: [...historyIds].sort((a, b) => a - b) },
		},
		async (tx, operationId) => {
			const entries = [];
			for (const id of historyIds) {
				const entry = await readHistory(tx, id);
				if (entry.kind !== "catalog_offer")
					throw new CatalogInputError("Invalid undo selection");
				entries.push(entry);
			}
			entries.sort((a, b) => Number(a.targetId) - Number(b.targetId));
			if (
				new Set(entries.map((entry) => entry.targetId)).size !== entries.length
			)
				throw new CatalogInputError("Duplicate undo target");
			await lockOfferHistoryPages(tx, entries);
			try {
				for (const entry of entries) await applyHistory(tx, entry, userId);
			} catch (error) {
				if (error instanceof Error && error.message === "conflict")
					throw new CatalogConflict(
						"Offers changed after this update. Undo was not applied.",
					);
				throw error;
			}
			await enqueueEffect(tx, operationId, "catalog.refresh");
			await enqueueEffect(tx, operationId, "catalog.export.request");
			return { changedCount: entries.length };
		},
	);
}
