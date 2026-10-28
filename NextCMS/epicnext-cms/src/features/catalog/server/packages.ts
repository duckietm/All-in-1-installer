import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { historySnapshot, recordHistory } from "@/features/history/server";
import { db, queryRows, rowsFrom } from "@/lib/db";
import { allocateCatalogItemId } from "@/lib/services/furni-import";
import { remapIncludes } from "../domain/duplicate";
import {
	assertParent,
	CatalogConflict,
	CatalogInputError,
	CatalogNotFound,
} from "../domain/hierarchy";
import {
	type CatalogPackage,
	type CreateCatalogPackageInput,
	createPackageSchema,
	type PackageListRow,
	type PackagePreview,
	type PackagePublication,
	type PublishCatalogPackageInput,
	packageIdSchema,
	publishPackageSchema,
	type SaveCatalogPackageInput,
	savePackageSchema,
	validatePackageDraft,
} from "../domain/packages";
import {
	columns,
	offerColumns,
	type PackageSource,
	type PackageTx,
	packageHash,
	pageColumns,
	publicSnapshot,
	readPackagePages,
	readPackageSource,
	type SourceRow,
} from "./package-snapshot";

interface StoredPackage {
	package: CatalogPackage;
	roots: number[];
	source: PackageSource;
	publication?: PackagePublication;
}
function encode(stored: StoredPackage) {
	const value = JSON.stringify(stored);
	if (Buffer.byteLength(value) > 8_000_000)
		throw new CatalogInputError("Package data exceeds 8 MB safety limit");
	return value;
}
async function read(
	tx: PackageTx,
	id: string,
	lock = false,
): Promise<StoredPackage> {
	const row = rowsFrom<{ payload: string }>(
		await tx.execute(
			sql`SELECT payload FROM website_catalog_packages WHERE id=${packageIdSchema.parse(id)}${lock ? sql` FOR UPDATE` : sql``}`,
		),
	)[0];
	if (!row) throw new CatalogNotFound("Catalog package not found");
	return JSON.parse(row.payload) as StoredPackage;
}
async function write(tx: PackageTx, stored: StoredPackage, create = false) {
	const p = stored.package,
		payload = encode(stored);
	if (create)
		await tx.execute(
			sql`INSERT INTO website_catalog_packages (id,name,version,status,mode,payload,updated_at) VALUES (${p.id},${p.name},${p.version},${p.status},${p.mode},${payload},CURRENT_TIMESTAMP)`,
		);
	else
		await tx.execute(
			sql`UPDATE website_catalog_packages SET name=${p.name}, version=${p.version}, status=${p.status}, payload=${payload}, updated_at=CURRENT_TIMESTAMP WHERE id=${p.id}`,
		);
}
export async function listCatalogPackagesCommand(): Promise<PackageListRow[]> {
	const rows = await queryRows<
		Omit<PackageListRow, "updatedAt"> & { updatedAt: Date | string }
	>(
		sql`SELECT id,name,version,status,mode,updated_at AS updatedAt FROM website_catalog_packages ORDER BY updated_at DESC,id LIMIT 100`,
	);
	return rows.map((row) => ({
		...row,
		version: Number(row.version),
		updatedAt: new Date(row.updatedAt).toISOString(),
	}));
}
export async function getCatalogPackageCommand(
	id: string,
): Promise<CatalogPackage> {
	return db.transaction(async (tx) => (await read(tx, id)).package);
}
export async function createCatalogPackageCommand(
	raw: CreateCatalogPackageInput,
): Promise<CatalogPackage> {
	const input = createPackageSchema.parse(raw);
	return db.transaction(
		async (tx) => {
			const roots = [...new Set(input.pageIds)].sort((a, b) => a - b);
			const pages = await readPackagePages(tx, false);
			assertParent(
				pages.map((p) => ({ id: Number(p.id), parentId: Number(p.parent_id) })),
				0,
				input.targetParentId,
			);
			const source = await readPackageSource(tx, pages, roots, false),
				baseline = publicSnapshot(source);
			const stored: StoredPackage = {
				package: {
					id: randomUUID(),
					name: input.name,
					version: 1,
					status: "draft",
					mode: input.mode,
					targetParentId: input.targetParentId,
					baseline,
					draft: structuredClone(baseline),
					updatedAt: new Date().toISOString(),
					publishedAt: null,
				},
				roots,
				source,
			};
			await write(tx, stored, true);
			return stored.package;
		},
		{ isolationLevel: "repeatable read" },
	);
}
export async function saveCatalogPackageCommand(
	raw: SaveCatalogPackageInput,
): Promise<CatalogPackage> {
	const input = savePackageSchema.parse(raw);
	return db.transaction(async (tx) => {
		const stored = await read(tx, input.id, true),
			p = stored.package;
		if (p.status !== "draft" || p.version !== input.version)
			throw new CatalogConflict("Package changed. Reload it before saving");
		p.draft = validatePackageDraft(p.baseline, input.draft);
		p.name = input.name;
		p.targetParentId = input.targetParentId;
		p.version++;
		p.updatedAt = new Date().toISOString();
		await write(tx, stored);
		return p;
	});
}
async function review(
	tx: PackageTx,
	stored: StoredPackage,
	lock: boolean,
): Promise<{
	preview: PackagePreview;
	source?: PackageSource;
	pages: SourceRow[];
}> {
	const p = stored.package,
		conflicts: string[] = [];
	const pages = await readPackagePages(tx, lock);
	let source: PackageSource | undefined;
	try {
		validatePackageDraft(p.baseline, p.draft);
		source = await readPackageSource(tx, pages, stored.roots, lock);
		if (packageHash(source) !== packageHash(stored.source))
			conflicts.push(
				"Source categories or offers changed since this package was created. Create a fresh package to include the current data.",
			);
		assertParent(
			pages.map((row) => ({
				id: Number(row.id),
				parentId: Number(row.parent_id),
			})),
			0,
			p.targetParentId,
		);
		const existing = new Set(pages.map((row) => Number(row.id)));
		if (p.mode === "copy")
			for (const page of source.pages)
				remapIncludes(page.includes, new Map(), existing);
	} catch (error) {
		if (error instanceof CatalogInputError || error instanceof CatalogNotFound)
			conflicts.push(error.message);
		else throw error;
	}
	const destination = pages.find(
		(page) => Number(page.id) === p.targetParentId,
	);
	const count = (kind: "pages" | "offers") =>
		p.mode === "copy"
			? p.draft[kind].length
			: p.draft[kind].filter(
					(row) =>
						packageHash(row) !==
						packageHash(p.baseline[kind].find((base) => base.id === row.id)),
				).length;
	return {
		pages,
		source,
		preview: {
			version: p.version,
			fingerprint: packageHash({
				id: p.id,
				version: p.version,
				mode: p.mode,
				target: p.targetParentId,
				draft: p.draft,
				source,
				destination,
				conflicts,
			}),
			changedPages: count("pages"),
			changedOffers: count("offers"),
			conflicts,
		},
	};
}
export async function previewCatalogPackageCommand(
	id: string,
): Promise<PackagePreview> {
	return db.transaction(
		async (tx) => (await review(tx, await read(tx, id), false)).preview,
		{ isolationLevel: "repeatable read" },
	);
}
async function insertRow(
	tx: PackageTx,
	table: string,
	row: Record<string, unknown>,
): Promise<number> {
	const [result] = await tx.execute(
		sql`INSERT INTO ${sql.identifier(table)} SET ${sql.join(
			Object.entries(row)
				.filter(([, value]) => value !== undefined)
				.map(([key, value]) => sql`${sql.identifier(key)}=${value}`),
			sql`, `,
		)}`,
	);
	const id = Number(row.id ?? result.insertId);
	if (!Number.isSafeInteger(id) || id <= 0)
		throw Error("Could not allocate package row ID");
	return id;
}
async function updateRow(
	tx: PackageTx,
	table: string,
	id: number,
	row: Record<string, unknown>,
) {
	await tx.execute(
		sql`UPDATE ${sql.identifier(table)} SET ${sql.join(
			Object.entries(row).map(
				([key, value]) => sql`${sql.identifier(key)}=${value}`,
			),
			sql`, `,
		)} WHERE id=${id}`,
	);
}
async function publishCatalogPackageAttempt(
	raw: PublishCatalogPackageInput,
	userId?: number,
): Promise<PackagePublication> {
	const input = publishPackageSchema.parse(raw);
	const initial = await getCatalogPackageCommand(input.id);
	// Reserve offer identifiers outside catalog row locks, following the normal importer lock order.
	const reserved: number[] = [];
	if (initial.mode === "copy" && initial.status === "draft")
		for (let i = 0; i < initial.draft.offers.length; i++)
			reserved.push(await allocateCatalogItemId(async (id) => id));
	return db.transaction(
		async (tx) => {
			const stored = await read(tx, input.id, true),
				p = stored.package;
			if (p.status === "published" && stored.publication)
				return { ...stored.publication, alreadyPublished: true };
			if (p.version !== input.version)
				throw new CatalogConflict(
					"Package changed. Refresh the publication preview",
				);
			const { preview, source, pages } = await review(tx, stored, true);
			if (
				preview.conflicts.length ||
				preview.fingerprint !== input.fingerprint ||
				!source
			)
				throw new CatalogConflict(
					preview.conflicts.join(" ") ||
						"Catalog changed. Refresh the publication preview",
				);
			const pageIds: number[] = [];
			if (p.mode === "update") {
				for (const page of p.draft.pages) {
					const historyBefore = userId
						? await historySnapshot(tx, "category", page.id)
						: null;
					await updateRow(
						tx,
						"catalog_pages",
						page.id,
						columns(page, pageColumns),
					);
					if (historyBefore && userId)
						await recordHistory(tx, "category", page.id, userId, historyBefore);
					pageIds.push(page.id);
				}
				for (const offer of p.draft.offers) {
					const historyBefore = userId
						? await historySnapshot(tx, "prices", offer.id)
						: null;
					await updateRow(
						tx,
						"catalog_items",
						offer.id,
						columns(offer, offerColumns),
					);
					if (historyBefore && userId)
						await recordHistory(tx, "prices", offer.id, userId, historyBefore);
				}
			} else {
				if (reserved.length !== source.offers.length)
					throw new CatalogConflict(
						"Package changed. Refresh the publication preview",
					);
				const map = new Map<number, number>(),
					selected = new Set(source.pages.map((page) => Number(page.id)));
				const pending = [...p.draft.pages];
				while (pending.length) {
					const index = pending.findIndex(
						(page) => !selected.has(page.parentId) || map.has(page.parentId),
					);
					if (index < 0)
						throw new CatalogInputError("Package hierarchy contains a cycle");
					const [page] = pending.splice(index, 1),
						original = source.pages.find((row) => Number(row.id) === page.id);
					if (!original)
						throw new CatalogConflict(
							"Package source category no longer exists",
						);
					const { id: _id, ...row } = original;
					Object.assign(row, columns(page, pageColumns), {
						parent_id: map.get(page.parentId) ?? p.targetParentId,
						includes: "",
					});
					const id = await insertRow(tx, "catalog_pages", row);
					map.set(page.id, id);
					pageIds.push(id);
				}
				const existing = new Set(pages.map((page) => Number(page.id)));
				for (const page of source.pages)
					if (page.includes) {
						const includes = remapIncludes(page.includes, map, existing);
						if (includes.length > 128)
							throw new CatalogInputError(
								"Remapped included category references exceed 128 characters",
							);
						await updateRow(
							tx,
							"catalog_pages",
							Number(map.get(Number(page.id))),
							{
								includes,
							},
						);
					}
				const offerMap = new Map(
					source.offers.map((offer, index) => [
						Number(offer.id),
						reserved[index],
					]),
				);
				for (const offer of p.draft.offers) {
					const original = source.offers.find(
						(row) => Number(row.id) === offer.id,
					);
					if (!original)
						throw new CatalogConflict("Package source offer no longer exists");
					const row: Record<string, unknown> = {
						...original,
						...columns(offer, offerColumns),
						id: offerMap.get(offer.id),
						page_id: String(map.get(offer.pageId)),
					};
					if (
						Number(original.offer_id) > 0 &&
						offerMap.has(Number(original.offer_id))
					)
						row.offer_id = offerMap.get(Number(original.offer_id));
					await insertRow(tx, "catalog_items", row);
				}
			}
			const result: PackagePublication = {
				pageIds,
				offerCount: p.draft.offers.length,
				alreadyPublished: false,
			};
			p.status = "published";
			p.version++;
			p.publishedAt = new Date().toISOString();
			p.updatedAt = p.publishedAt;
			stored.publication = result;
			await write(tx, stored);
			return result;
		},
		{ isolationLevel: "repeatable read" },
	);
}

/** An ID reserved by another process can race our process-local allocator. A collision rolls back the entire copy before retry. */
export async function publishCatalogPackageCommand(
	input: PublishCatalogPackageInput,
	userId?: number,
): Promise<PackagePublication> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await publishCatalogPackageAttempt(input, userId);
		} catch (error) {
			let cause: unknown = error,
				duplicate = false;
			for (
				let depth = 0;
				cause && typeof cause === "object" && depth < 5;
				depth++
			) {
				const record = cause as {
					code?: string;
					errno?: number;
					cause?: unknown;
				};
				if (record.code === "ER_DUP_ENTRY" || record.errno === 1062) {
					duplicate = true;
					break;
				}
				cause = record.cause;
			}
			if (!duplicate || attempt >= 2) throw error;
		}
	}
}
