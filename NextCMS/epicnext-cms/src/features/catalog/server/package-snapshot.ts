import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { rowsFrom } from "@/lib/db";
import {
	assertParent,
	CatalogInputError,
	CatalogNotFound,
} from "../domain/hierarchy";
import { parseFurnitureIds } from "../domain/offer-input";
import type { PackageSnapshot } from "../domain/packages";
import { packageSnapshotSchema } from "../domain/packages";
export type PackageTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type SourceRow = Record<string, unknown> & { id: number };
export interface PackageSource {
	pages: SourceRow[];
	offers: SourceRow[];
}
export function packageHash(value: unknown): string {
	const canonical = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(canonical);
		if (v && typeof v === "object")
			return Object.fromEntries(
				Object.entries(v)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([k, val]) => [k, canonical(val)]),
			);
		return v;
	};
	return createHash("sha256")
		.update(JSON.stringify(canonical(JSON.parse(JSON.stringify(value)))))
		.digest("hex");
}
export const pageColumns = {
	parentId: "parent_id",
	caption: "caption",
	enabled: "enabled",
	visible: "visible",
	iconImage: "icon_image",
	minRank: "min_rank",
	clubOnly: "club_only",
	vipOnly: "vip_only",
	orderNum: "order_num",
	pageLayout: "page_layout",
} as const;
export const offerColumns = {
	pageId: "page_id",
	catalogName: "catalog_name",
	itemIds: "item_ids",
	costCredits: "cost_credits",
	costPoints: "cost_points",
	pointsType: "points_type",
	amount: "amount",
} as const;
export function publicSnapshot(source: PackageSource): PackageSnapshot {
	return packageSnapshotSchema.parse({
		pages: source.pages.map((p) => ({
			id: Number(p.id),
			parentId: Number(p.parent_id),
			caption: String(p.caption),
			enabled: String(p.enabled),
			visible: String(p.visible),
			iconImage: Number(p.icon_image),
			minRank: Number(p.min_rank),
			clubOnly: String(p.club_only),
			vipOnly: String(p.vip_only),
			orderNum: Number(p.order_num),
			pageLayout: String(p.page_layout),
		})),
		offers: source.offers.map((o) => ({
			id: Number(o.id),
			pageId: Number(o.page_id),
			catalogName: String(o.catalog_name),
			clubOnly: String(o.club_only ?? "0"),
			itemIds: String(o.item_ids),
			costCredits: Number(o.cost_credits),
			costPoints: Number(o.cost_points),
			pointsType: Number(o.points_type),
			amount: Number(o.amount),
		})),
	});
}
export async function readPackagePages(
	tx: PackageTx,
	lock: boolean,
): Promise<SourceRow[]> {
	const pages = rowsFrom<SourceRow>(
		await tx.execute(
			sql`SELECT * FROM catalog_pages ORDER BY id LIMIT 20001${lock ? sql` FOR UPDATE` : sql``}`,
		),
	);
	if (pages.length > 20000)
		throw new CatalogInputError(
			"Catalog exceeds package safety limit (20000 categories)",
		);
	return pages;
}
export async function readPackageSource(
	tx: PackageTx,
	pages: SourceRow[],
	rootIds: number[],
	lock: boolean,
): Promise<PackageSource> {
	const hierarchy = pages.map((p) => ({
		id: Number(p.id),
		parentId: Number(p.parent_id),
	}));
	const selected = new Set(rootIds);
	for (const id of rootIds) {
		const page = hierarchy.find((p) => p.id === id);
		if (!page)
			throw new CatalogNotFound(
				`Package source category #${id} no longer exists`,
			);
		assertParent(hierarchy, id, page.parentId);
	}
	let changed = true;
	while (changed) {
		changed = false;
		for (const page of hierarchy)
			if (selected.has(page.parentId) && !selected.has(page.id)) {
				selected.add(page.id);
				changed = true;
			}
		if (selected.size > 200)
			throw new CatalogInputError(
				"A package supports at most 200 categories including descendants",
			);
	}
	const selectedPages = pages.filter((p) => selected.has(Number(p.id)));
	const ids = selectedPages.map((p) => String(p.id));
	const offers = rowsFrom<SourceRow>(
		await tx.execute(
			sql`SELECT * FROM catalog_items WHERE page_id IN (${sql.join(ids, sql`, `)}) ORDER BY id LIMIT 501${lock ? sql` FOR UPDATE` : sql``}`,
		),
	);
	if (offers.length > 500)
		throw new CatalogInputError("A package supports at most 500 offers");
	const furnitureIds = [
		...new Set(offers.flatMap((o) => parseFurnitureIds(String(o.item_ids)))),
	].sort((a, b) => a - b);
	if (furnitureIds.length > 5000)
		throw new CatalogInputError(
			"Package furniture references exceed safety limit",
		);
	if (furnitureIds.length) {
		const found = new Set(
			rowsFrom<{ id: number }>(
				await tx.execute(
					sql`SELECT id FROM items_base WHERE id IN (${sql.join(furnitureIds, sql`, `)}) ORDER BY id${lock ? sql` FOR UPDATE` : sql``}`,
				),
			).map((row) => Number(row.id)),
		);
		if (furnitureIds.some((id) => !found.has(id)))
			throw new CatalogNotFound("Package furniture reference no longer exists");
	}
	return { pages: selectedPages, offers };
}
export function columns(
	row: Record<string, unknown>,
	mapping: Record<string, string>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(mapping).map(([key, column]) => [column, row[key]]),
	);
}
