import "server-only";
import { getTableColumns, type SQL, sql } from "drizzle-orm";
import { historySnapshot, recordHistory } from "@/features/history/server";
import { CatalogPages, CatalogPagesBc, db, rowsFrom } from "@/lib/db";
import {
	assertParent,
	CatalogConflict,
	CatalogInputError,
	CatalogNotFound,
	collectSubtree,
	type HierarchyPage,
	nextFreeSiblingOrder,
	positiveId,
	validateSiblingOrder,
} from "../domain/hierarchy";
import { pagePatchSchema } from "../domain/page-input";
export type CatalogKind = "normal" | "bc";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
function tables(kind: CatalogKind) {
	if (kind !== "normal" && kind !== "bc")
		throw new CatalogInputError("Invalid catalog type");
	return {
		pages: kind === "bc" ? CatalogPagesBc : CatalogPages,
		items: sql.identifier(kind === "bc" ? "catalog_items_bc" : "catalog_items"),
	};
}
async function lockedPages(
	tx: Transaction,
	kind: CatalogKind,
): Promise<HierarchyPage[]> {
	const { pages } = tables(kind);
	// Structural commands serialize against a stable lock order, including parent validation.
	const rows = rowsFrom<HierarchyPage>(
		await tx.execute(
			sql`SELECT id, parent_id AS parentId, order_num AS orderNum FROM ${pages} ORDER BY id FOR UPDATE`,
		),
	);
	return rows.map((row) => ({
		id: Number(row.id),
		parentId: Number(row.parentId),
		orderNum: Number(row.orderNum),
	}));
}
function fieldsSql(kind: CatalogKind, fields: Record<string, unknown>): SQL[] {
	const columns = getTableColumns(tables(kind).pages);
	return Object.entries(fields)
		.filter(
			([key, value]) => value !== undefined && Object.hasOwn(columns, key),
		)
		.map(
			([key, value]) =>
				sql`${sql.identifier(columns[key as keyof typeof columns].name)} = ${value}`,
		);
}
export async function updatePageCommand(
	kind: CatalogKind,
	id: number,
	fields: Record<string, unknown>,
	expected?: Record<string, unknown>,
	userId?: number,
) {
	positiveId(id);
	const data = pagePatchSchema.parse(fields);
	return db.transaction(async (tx) => {
		const rows = await lockedPages(tx, kind);
		if (!rows.some((row) => row.id === id))
			throw new CatalogNotFound("Catalog page not found");
		if (expected) {
			const columns = getTableColumns(tables(kind).pages);
			const current = rowsFrom<Record<string, unknown>>(
				await tx.execute(
					sql`SELECT * FROM ${tables(kind).pages} WHERE id=${id} FOR UPDATE`,
				),
			)[0];
			if (!current) throw new CatalogNotFound("Catalog page not found");
			for (const [key, value] of Object.entries(expected)) {
				if (!Object.hasOwn(data, key) || !Object.hasOwn(columns, key)) continue;
				const column = columns[key as keyof typeof columns];
				if (String(current[column.name] ?? "") !== String(value ?? ""))
					throw new CatalogConflict(
						"This category was modified by another operator. Reload before saving.",
					);
			}
		}
		const historyKind = kind === "bc" ? "category_bc" : "category";
		const before = userId ? await historySnapshot(tx, historyKind, id) : null;
		if (data.parentId !== undefined) assertParent(rows, id, data.parentId);
		const assignments = fieldsSql(kind, data);
		if (!assignments.length)
			throw new CatalogInputError("No valid fields to update");
		await tx.execute(
			sql`UPDATE ${tables(kind).pages} SET ${sql.join(assignments, sql`, `)} WHERE id=${id}`,
		);
		if (before && userId)
			await recordHistory(tx, historyKind, id, userId, before);
	});
}
export async function createPageCommand(
	kind: CatalogKind,
	fields: Record<string, unknown>,
): Promise<number> {
	const data = pagePatchSchema.parse(fields);
	if (!data.caption) throw new CatalogInputError("Category name is required");
	return db.transaction(async (tx) => {
		const rows = await lockedPages(tx, kind);
		const parentId = data.parentId ?? -1;
		assertParent(rows, 0, parentId);
		const assignments = fieldsSql(kind, {
			...data,
			// Never trust a caller-supplied order number: the emulator rejects a
			// catalog where two siblings share one.
			orderNum: nextFreeSiblingOrder(rows, parentId, data.orderNum),
			captionSave: data.captionSave ?? data.caption?.slice(0, 25),
		});
		const [result] = await tx.execute(
			sql`INSERT INTO ${tables(kind).pages} SET ${sql.join(assignments, sql`, `)}`,
		);
		return Number(result.insertId);
	});
}
export async function reorderPagesCommand(
	kind: CatalogKind,
	input: { parentId: number; ids: number[]; expectedIds: number[] },
) {
	return db.transaction(async (tx) => {
		const rows = await lockedPages(tx, kind);
		validateSiblingOrder(rows, input.parentId, input.ids, input.expectedIds);
		for (const [index, id] of input.ids.entries())
			await tx.execute(
				sql`UPDATE ${tables(kind).pages} SET order_num=${index + 1} WHERE id=${id}`,
			);
	});
}
export async function deletePageCommand(
	kind: CatalogKind,
	id: number,
	mode: "reparent" | "cascade",
) {
	positiveId(id);
	if (mode !== "reparent" && mode !== "cascade")
		throw new CatalogInputError("Invalid delete mode");
	return db.transaction(async (tx) => {
		const rows = await lockedPages(tx, kind);
		const page = rows.find((row) => row.id === id);
		if (!page) return { deletedPages: 0, movedChildren: 0 };
		const { pages, items } = tables(kind);
		let ids = [id];
		let movedChildren = 0;
		if (mode === "reparent") {
			assertParent(rows, id, page.parentId);
			movedChildren = rows.filter((row) => row.parentId === id).length;
			await tx.execute(
				sql`UPDATE ${pages} SET parent_id=${page.parentId} WHERE parent_id=${id}`,
			);
		} else ids = collectSubtree(rows, id);
		// String literals match INT and VARCHAR page_id installations without casting the indexed column.
		await tx.execute(
			sql`DELETE FROM ${items} WHERE page_id IN (${sql.join(ids.map(String), sql`, `)})`,
		);
		await tx.execute(
			sql`DELETE FROM ${pages} WHERE id IN (${sql.join(ids, sql`, `)})`,
		);
		return { deletedPages: ids.length, movedChildren };
	});
}
export async function togglePageCommand(
	kind: CatalogKind,
	id: number,
	field: "enabled" | "visible",
	userId?: number,
) {
	positiveId(id);
	if (field !== "enabled" && field !== "visible")
		throw new CatalogInputError("Invalid toggle field");
	return db.transaction(async (tx) => {
		const rows = await lockedPages(tx, kind);
		if (!rows.some((row) => row.id === id))
			throw new CatalogNotFound("Catalog page not found");
		const historyKind = kind === "bc" ? "category_bc" : "category";
		const before = userId ? await historySnapshot(tx, historyKind, id) : null;
		const column = sql.identifier(field);
		await tx.execute(
			sql`UPDATE ${tables(kind).pages} SET ${column}=CASE WHEN ${column}='1' THEN '0' ELSE '1' END WHERE id=${id}`,
		);
		if (before && userId)
			await recordHistory(tx, historyKind, id, userId, before);
	});
}
