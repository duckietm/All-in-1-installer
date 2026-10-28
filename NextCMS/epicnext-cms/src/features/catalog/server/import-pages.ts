import "server-only";

import { sql } from "drizzle-orm";
import { queryRows } from "@/lib/db";

/**
 * Locate the auto-created "Imported Furniture" tree (caption_save
 * 'imported_furni' root) and every category sub-page beneath it. These are the
 * pages the import pipeline fills without review, so the organize-import tool
 * knows exactly which furniture is "inbox" work.
 */
export async function getImportedCategoryPageIds(): Promise<number[]> {
	const rows = await queryRows<{ id: number }>(sql`
    SELECT id FROM catalog_pages
    WHERE caption_save = 'imported_furni'
      AND parent_id IN (-1, 0)
    LIMIT 1
  `);
	const rootId = Number(rows[0]?.id ?? 0);
	if (!rootId) return [];

	const childRows = await queryRows<{ id: number }>(sql`
    SELECT id FROM catalog_pages WHERE parent_id = ${rootId}
  `);
	const children = childRows.map((r) => Number(r.id));

	const pageIds = [rootId, ...children];
	if (children.length > 0) {
		const grandRows = await queryRows<{ id: number }>(sql`
      SELECT id FROM catalog_pages
      WHERE parent_id IN (${sql.join(children, sql`, `)})
    `);
		pageIds.push(...grandRows.map((r) => Number(r.id)));
	}
	return pageIds;
}

/** Caption of the imported-furniture root page, when present. */
export async function getImportedRootCaption(): Promise<string | null> {
	const rows = await queryRows<{ caption: string }>(sql`
    SELECT caption FROM catalog_pages
    WHERE caption_save = 'imported_furni'
      AND parent_id IN (-1, 0)
    LIMIT 1
  `);
	return rows[0]?.caption ?? null;
}
