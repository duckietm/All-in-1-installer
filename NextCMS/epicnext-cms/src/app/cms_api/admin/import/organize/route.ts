import { sql } from "drizzle-orm";
import {
	groupSuggestedCategories,
	type SugFurniEntry,
} from "@/features/catalog/domain/organize";
import {
	getImportedCategoryPageIds,
	getImportedRootCaption,
} from "@/features/catalog/server/import-pages";
import { apiOk } from "@/lib/api";
import { withAdmin } from "@/lib/api-handler";
import { db, ItemsBase, queryRows } from "@/lib/db";
import { PERMS } from "@/lib/permissions";

interface OrganizeItem {
	itemId: number;
	itemName: string;
	publicName: string;
	type: string;
	spriteId: number;
	interactionType: string;
	catalogItemId: number | null;
	sourcePageId: number | null;
	sourcePageCaption: string | null;
	alreadyPlaced: boolean;
}

/** Parse the base-item ids stored in an offer's item_ids column. */
function parseItemIds(raw: string): number[] {
	return String(raw ?? "")
		.split(/[;,]/)
		.map((s) => Number(s.trim()))
		.filter((n) => Number.isFinite(n) && n > 0);
}

export const GET = withAdmin(
	{ permission: PERMS.CATALOG_VIEW },
	async (request) => {
		const sp = request.nextUrl.searchParams;
		// No limit means "show everything" — the query is bounded by the actual
		// size of the imported-furniture tree anyway. The cap only guards against
		// pathological databases.
		const rawLimit = Number(sp.get("limit"));
		const limit =
			Number.isFinite(rawLimit) && rawLimit > 0
				? Math.min(rawLimit, 50000)
				: 50000;
		const days = Math.min(Math.max(Number(sp.get("days") || 30) || 30, 1), 365);
		const sinceIso = new Date(
			Date.now() - days * 24 * 60 * 60 * 1000,
		).toISOString();
		const since = sinceIso.slice(0, 19).replace("T", " ");

		const pageIds = await getImportedCategoryPageIds();

		// 1) Offers already living in the imported-furniture tree. No join, so
		//    this stays bounded by the (small) page-id set instead of scanning
		//    the whole catalog or forcing function-based lookups.
		const placedById = new Map<number, OrganizeItem>();
		const itemIdsToResolve = new Set<number>();
		if (pageIds.length > 0) {
			const rows = await queryRows<Record<string, unknown>>(sql`
        SELECT ci.id AS catalogItemId,
               ci.page_id AS sourcePageId,
               ci.item_ids AS itemIds,
               p.caption AS sourcePageCaption,
               ci.order_number AS orderNumber
        FROM catalog_items ci
        INNER JOIN catalog_pages p ON p.id = ci.page_id
        WHERE ci.page_id IN (${sql.join(pageIds, sql`, `)})
        ORDER BY ci.id
        LIMIT ${limit}
      `);

			for (const r of rows) {
				const parsed = parseItemIds(String(r.itemIds ?? ""));
				if (parsed.length === 0) continue;
				const id = parsed[0];
				itemIdsToResolve.add(id);
				placedById.set(id, {
					itemId: id,
					itemName: "",
					publicName: String(r.sourcePageCaption ?? ""),
					type: "s",
					spriteId: 0,
					interactionType: "default",
					catalogItemId: Number(r.catalogItemId),
					sourcePageId: Number(r.sourcePageId) || null,
					sourcePageCaption: r.sourcePageCaption
						? String(r.sourcePageCaption)
						: null,
					alreadyPlaced: true,
				});
			}
		}

		// 2) Recently imported furniture. Bounded candidate list first, matched
		//    against the import tree in JS — never a correlated FIND_IN_SET scan.
		const candidateRows = await queryRows<{ itemId: number }>(sql`
      SELECT DISTINCT alog.target_id AS itemId
      FROM admin_audit_log alog
      WHERE alog.action = 'furni_import'
        AND alog.target = 'ItemsBase'
        AND alog.target_id IS NOT NULL
        AND alog.created_at >= ${since}
      ORDER BY itemId DESC
      LIMIT 2000
    `);

		for (const r of candidateRows) {
			const itemId = Number(r.itemId);
			if (!Number.isFinite(itemId)) continue;
			if (placedById.has(itemId)) continue;
			if (itemIdsToResolve.size >= limit) break;
			itemIdsToResolve.add(itemId);
		}

		// 3) Resolve base-item metadata in ONE indexed query.
		const baseMap = new Map<
			number,
			{
				itemName: string;
				publicName: string;
				type: string;
				spriteId: number;
				interactionType: string;
			}
		>();
		if (itemIdsToResolve.size > 0) {
			const bases = await db
				.select({
					id: ItemsBase.id,
					itemName: ItemsBase.itemName,
					publicName: ItemsBase.publicName,
					type: ItemsBase.type,
					spriteId: ItemsBase.spriteId,
					interactionType: ItemsBase.interactionType,
				})
				.from(ItemsBase)
				.where(
					sql`${ItemsBase.id} IN (${sql.join(
						[...itemIdsToResolve].map((id) => sql`${id}`),
						sql`, `,
					)})`,
				);
			for (const b of bases) {
				baseMap.set(b.id, {
					itemName: String(b.itemName ?? ""),
					publicName: String(b.publicName ?? ""),
					type: String(b.type ?? "s"),
					spriteId: Number(b.spriteId) || 0,
					interactionType: String(b.interactionType ?? "default"),
				});
			}
		}

		// 4) Merge: placed offers (with metadata backfilled) first, then new.
		const items: OrganizeItem[] = [];
		for (const [id, entry] of placedById) {
			const meta = baseMap.get(id);
			items.push({
				...entry,
				itemName: meta?.itemName ?? entry.itemName,
				publicName: meta?.publicName ?? entry.publicName,
				type: meta?.type ?? entry.type,
				spriteId: meta?.spriteId ?? entry.spriteId,
				interactionType: meta?.interactionType ?? entry.interactionType,
			});
		}

		let claimed = items.length;
		for (const r of candidateRows) {
			if (claimed >= limit) break;
			const itemId = Number(r.itemId);
			if (!Number.isFinite(itemId)) continue;
			if (placedById.has(itemId)) continue;
			const meta = baseMap.get(itemId);
			if (!meta) continue;
			items.push({
				itemId,
				itemName: meta.itemName,
				publicName: meta.publicName,
				type: meta.type,
				spriteId: meta.spriteId,
				interactionType: meta.interactionType,
				catalogItemId: null,
				sourcePageId: null,
				sourcePageCaption: null,
				alreadyPlaced: false,
			});
			claimed++;
		}

		items.sort((a, b) => {
			return (
				Number(b.alreadyPlaced) - Number(a.alreadyPlaced) || b.itemId - a.itemId
			);
		});

		// 5) Group on the server so the client only ever sees compact, ready-made
		//    categories instead of a giant raw item array.
		type SugFurniEntryExtra = SugFurniEntry & {
			alreadyPlaced?: boolean;
			catalogItemId?: number;
			spriteId?: number;
			sourcePageCaption?: string;
			itemId?: number;
		};
		// Map to the extended shape so groupSuggestedCategories accepts it,
		// then we can use the extra fields in the returned groups.
		const sugItems = items.map((it) => ({
			id: it.itemId,
			itemId: it.itemId,
			itemName: it.itemName,
			publicName: it.publicName,
			type: it.type,
			spriteId: it.spriteId,
			interactionType: it.interactionType,
			alreadyPlaced: it.alreadyPlaced,
			catalogItemId: it.catalogItemId,
			sourcePageCaption: it.sourcePageCaption,
		})) as SugFurniEntryExtra[];
		const groups = groupSuggestedCategories(sugItems).map((g) => {
			const moved = g.items.filter((i) => i.alreadyPlaced).length;
			return {
				name: g.name,
				icon: g.icon,
				layout: g.layout?.layout ?? null,
				total: g.items.length,
				moved,
				added: g.items.length - moved,
				items: g.items.map((i) => ({
					itemId: i.itemId,
					catalogItemId: i.catalogItemId,
					alreadyPlaced: i.alreadyPlaced,
					itemName: i.itemName,
					publicName: i.publicName,
					spriteId: i.spriteId,
					type: i.type,
					interactionType: i.interactionType,
					sourcePageCaption: i.sourcePageCaption ?? null,
				})),
			};
		});

		const importRootPageId = pageIds[0] ?? null;
		return apiOk({
			groups,
			groupCount: groups.length,
			total: items.length,
			importRootPageId,
			importRootCaption: await getImportedRootCaption(),
		});
	},
);
