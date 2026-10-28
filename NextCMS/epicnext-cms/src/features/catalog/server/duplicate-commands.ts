import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, queryRows, rowsFrom } from "@/lib/db";
import { allocateCatalogItemId } from "@/lib/services/furni-import";
import {
	type DuplicateInput,
	type DuplicatePreview,
	type DuplicateRow,
	duplicateSubtree,
	remapIncludes,
} from "../domain/duplicate";
import { CatalogConflict, CatalogInputError } from "../domain/hierarchy";
import { parseFurnitureIds } from "../domain/offer-input";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const schema = z.object({
	kind: z.enum(["normal", "bc"]),
	sourceId: z.number().int().positive(),
	parentId: z.number().int().min(-1),
	name: z.string().trim().min(1).max(128),
});
function table(kind: DuplicateInput["kind"], offers = false) {
	return sql.identifier(
		`catalog_${offers ? "items" : "pages"}${kind === "bc" ? "_bc" : ""}`,
	);
}
async function snapshot(tx: Transaction, input: DuplicateInput, lock: boolean) {
	const suffix = lock ? sql` FOR UPDATE` : sql``;
	const pages = rowsFrom<DuplicateRow>(
		await tx.execute(
			sql`SELECT * FROM ${table(input.kind)} ORDER BY id LIMIT 20001${suffix}`,
		),
	);
	if (pages.length > 20000)
		throw new CatalogInputError(
			"Catalog exceeds duplication safety limit (20000 categories)",
		);
	const subtree = duplicateSubtree(pages, input.sourceId, input.parentId);
	const ids = subtree.map((p) => Number(p.id));
	const existing = new Set(pages.map((p) => Number(p.id)));
	for (const page of subtree)
		if (input.kind === "normal")
			remapIncludes(page.includes, new Map(), existing);
	const offers = rowsFrom<DuplicateRow>(
		await tx.execute(
			sql`SELECT * FROM ${table(input.kind, true)} WHERE page_id IN (${sql.join(ids.map(String), sql`, `)}) ORDER BY id LIMIT 5001${suffix}`,
		),
	);
	if (offers.length > 5000)
		throw new CatalogInputError("Duplicate at most 5000 offers at a time");
	const furniture = [
		...new Set(offers.flatMap((o) => parseFurnitureIds(String(o.item_ids)))),
	].sort((a, b) => a - b);
	if (furniture.length) {
		const found = new Set(
			rowsFrom<{ id: number }>(
				await tx.execute(
					sql`SELECT id FROM items_base WHERE id IN (${sql.join(furniture, sql`, `)}) ORDER BY id${suffix}`,
				),
			).map((p) => Number(p.id)),
		);
		if (furniture.some((id) => !found.has(id)))
			throw new CatalogInputError("Furniture reference not found");
	}
	const destination = pages.find((p) => Number(p.id) === input.parentId);
	const fingerprint = createHash("sha256")
		.update(
			JSON.stringify({
				input,
				subtree,
				offers,
				destination,
				siblings: pages.filter((page) =>
					input.parentId <= 0
						? Number(page.parent_id) <= 0
						: Number(page.parent_id) === input.parentId,
				),
			}),
		)
		.digest("hex");
	return {
		pages,
		subtree,
		offers,
		fingerprint,
		destination: String(destination?.caption ?? "Root"),
	};
}
export async function previewDuplicateCommand(
	raw: DuplicateInput,
): Promise<DuplicatePreview> {
	const input = schema.parse(raw);
	return db.transaction(
		async (tx) => {
			const data = await snapshot(tx, input, false);
			return {
				...input,
				fingerprint: data.fingerprint,
				pages: data.subtree.length,
				offers: data.offers.length,
				destination: data.destination,
			};
		},
		{ isolationLevel: "repeatable read" },
	);
}
export async function duplicateCategoryCommand(
	raw: DuplicatePreview,
): Promise<{ id: number; pages: number; offers: number }> {
	const input = schema.parse(raw);
	const expected = z
		.string()
		.regex(/^[a-f0-9]{64}$/)
		.parse(raw.fingerprint);
	const count = z.number().int().min(0).max(5000).parse(raw.offers);
	// Reserve through the same allocator as regular imports before taking page locks.
	// A database uniqueness conflict rolls back every copied row, including pages.
	const reserved: number[] = [];
	if (input.kind === "normal")
		for (let i = 0; i < count; i++)
			reserved.push(await allocateCatalogItemId(async (id) => id));
	return db.transaction(
		async (tx) => {
			const data = await snapshot(tx, input, true);
			if (data.fingerprint !== expected || data.offers.length !== count)
				throw new CatalogConflict(
					"Source or destination changed. Refresh the duplication preview.",
				);
			const ids = new Map<number, number>();
			const insert = async (row: Record<string, unknown>, offers = false) => {
				const entries = Object.entries(row).filter(([, v]) => v !== undefined);
				const [result] = await tx.execute(
					sql`INSERT INTO ${table(input.kind, offers)} SET ${sql.join(
						entries.map(([k, v]) => sql`${sql.identifier(k)}=${v}`),
						sql`, `,
					)}`,
				);
				const id = Number(row.id ?? result.insertId);
				if (!id) throw Error("Could not allocate duplicate category ID");
				return id;
			};
			for (const source of data.subtree) {
				const { id: oldId, ...row } = source;
				const isRoot = Number(oldId) === input.sourceId;
				row.parent_id = isRoot
					? input.parentId
					: ids.get(Number(source.parent_id));
				if (isRoot) {
					row.caption = input.name;
					row.enabled = "0";
					row.visible = "0";
					if (input.kind === "normal")
						row.caption_save = input.name.slice(0, 25);
				}
				if (input.kind === "normal") row.includes = "";
				ids.set(Number(oldId), await insert(row));
			}
			const existing = new Set(data.pages.map((p) => Number(p.id)));
			for (const source of data.subtree)
				if (input.kind === "normal" && source.includes) {
					const includes = remapIncludes(source.includes, ids, existing);
					if (includes.length > 128)
						throw new CatalogInputError(
							"Remapped category references exceed 128 characters",
						);
					await tx.execute(
						sql`UPDATE ${table(input.kind)} SET includes=${includes} WHERE id=${ids.get(Number(source.id))}`,
					);
				}
			const offerIds = new Map(
				data.offers.map((offer, index) => [Number(offer.id), reserved[index]]),
			);
			for (const [index, source] of data.offers.entries()) {
				const { id: _id, ...row } = source;
				row.page_id = String(ids.get(Number(source.page_id)));
				if (input.kind === "normal") {
					row.id = reserved[index];
					if (Number(row.offer_id) > 0 && offerIds.has(Number(row.offer_id)))
						row.offer_id = offerIds.get(Number(row.offer_id));
				}
				await insert(row, true);
			}
			return {
				id: ids.get(input.sourceId) as number,
				pages: data.subtree.length,
				offers: data.offers.length,
			};
		},
		{ isolationLevel: "repeatable read" },
	);
}

export async function duplicateDestinationsCommand(
	kind: DuplicateInput["kind"],
) {
	z.enum(["normal", "bc"]).parse(kind);
	const pages = await queryRows<{ id: number; caption: string }>(
		sql`SELECT id, caption FROM ${table(kind)} ORDER BY caption, id LIMIT 20001`,
	);
	if (pages.length > 20000)
		throw new CatalogInputError(
			"Catalog exceeds duplication safety limit (20000 categories)",
		);
	return pages.map((row) => ({ id: Number(row.id), caption: row.caption }));
}
