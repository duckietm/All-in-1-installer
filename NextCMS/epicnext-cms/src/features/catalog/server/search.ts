import "server-only";
import { sql } from "drizzle-orm";
import { queryRows } from "@/lib/db";
import { type CatalogSearchResult, parseCatalogSearch } from "../domain/search";

const LIMIT = 25;
const MAX_PATH_DEPTH = 16;
type PageRow = { id: number; caption: string; parentId: number };
type FurnitureRow = { id: number; classname: string; spriteId: number };
type OfferRow = {
	id: number;
	caption: string;
	pageId: number;
	pageCaption: string;
	parentId: number;
	itemIds: string;
};

export async function searchCatalog(
	kind: string,
	query: string,
): Promise<CatalogSearchResult[]> {
	const input = parseCatalogSearch(kind, query);
	const pages = sql.identifier(
		input.kind === "bc" ? "catalog_pages_bc" : "catalog_pages",
	);
	const offers = sql.identifier(
		input.kind === "bc" ? "catalog_items_bc" : "catalog_items",
	);
	const number = input.numericId;
	const [categoryData, furnitureData] = await Promise.all([
		queryRows<PageRow>(
			sql`SELECT id, caption, parent_id AS parentId FROM ${pages} WHERE caption LIKE ${input.pattern} ESCAPE '=' ${number === null ? sql`` : sql`OR id=${number}`} ORDER BY ${number === null ? sql`id` : sql`CASE WHEN id=${number} THEN 0 ELSE 1 END, id`} LIMIT 12`,
		),
		queryRows<FurnitureRow>(
			sql`SELECT id, item_name AS classname, sprite_id AS spriteId FROM items_base WHERE item_name LIKE ${input.pattern} ESCAPE '=' OR public_name LIKE ${input.pattern} ESCAPE '=' ${number === null ? sql`` : sql`OR id=${number} OR sprite_id=${number}`} ORDER BY ${number === null ? sql`id` : sql`CASE WHEN id=${number} THEN 0 ELSE 1 END, id`} LIMIT 25`,
		),
	]);
	const categories = categoryData.slice(0, 12);
	const furniture = furnitureData.slice(0, LIMIT);
	const predicates = [sql`i.catalog_name LIKE ${input.pattern} ESCAPE '='`];
	if (number !== null) {
		predicates.push(sql`i.id=${number}`, sql`i.page_id=${String(number)}`);
		if (input.kind === "normal") predicates.push(sql`i.offer_id=${number}`);
	}
	// The legacy semicolon relation has no join index. Cap candidate furniture IDs before testing bundle membership.
	for (const base of furniture)
		predicates.push(
			sql`FIND_IN_SET(${String(base.id)}, REPLACE(i.item_ids, ';', ',')) > 0`,
		);
	const offerData = await queryRows<OfferRow>(
		sql`SELECT i.id, i.catalog_name AS caption, i.page_id AS pageId, i.item_ids AS itemIds, p.caption AS pageCaption, p.parent_id AS parentId FROM ${offers} i INNER JOIN ${pages} p ON p.id=i.page_id WHERE ${sql.join(predicates, sql` OR `)} ORDER BY ${number === null ? sql`i.id` : sql`CASE WHEN i.id=${number} THEN 0 ELSE 1 END, i.id`} LIMIT ${LIMIT - categories.length}`,
	);
	const matches = offerData.slice(0, LIMIT - categories.length);
	const pageMap = new Map<number, PageRow>();
	for (const page of categories)
		pageMap.set(Number(page.id), {
			...page,
			id: Number(page.id),
			parentId: Number(page.parentId),
		});
	for (const offer of matches)
		pageMap.set(Number(offer.pageId), {
			id: Number(offer.pageId),
			caption: offer.pageCaption,
			parentId: Number(offer.parentId),
		});
	let frontier = [...pageMap.values()].map((page) => page.parentId);
	const attempted = new Set(pageMap.keys());
	for (let depth = 0; depth < MAX_PATH_DEPTH; depth++) {
		const ids = [...new Set(frontier)]
			.filter((id) => id > 0 && !attempted.has(id))
			.slice(0, LIMIT);
		if (!ids.length) break;
		for (const id of ids) attempted.add(id);
		const parents = await queryRows<PageRow>(
			sql`SELECT id, caption, parent_id AS parentId FROM ${pages} WHERE id IN (${sql.join(ids, sql`, `)}) LIMIT 25`,
		);
		frontier = [];
		for (const raw of parents) {
			const page = {
				...raw,
				id: Number(raw.id),
				parentId: Number(raw.parentId),
			};
			pageMap.set(page.id, page);
			frontier.push(page.parentId);
		}
	}
	function pagePath(id: number) {
		const path: string[] = [];
		const seen = new Set<number>();
		let current = id;
		while (current > 0 && !seen.has(current) && seen.size <= MAX_PATH_DEPTH) {
			seen.add(current);
			const page = pageMap.get(current);
			if (!page) {
				path.unshift(`#${current}`);
				break;
			}
			path.unshift(page.caption);
			current = page.parentId;
		}
		return path;
	}
	const href = (id: number) =>
		input.kind === "bc"
			? `/admin/catalog/builder-club/${id}`
			: `/admin/catalog/${id}`;
	return [
		...categories.map(
			(page): CatalogSearchResult => ({
				kind: "category",
				id: Number(page.id),
				pageId: Number(page.id),
				caption: page.caption,
				path: pagePath(Number(page.id)),
				href: href(Number(page.id)),
			}),
		),
		...matches.map((offer): CatalogSearchResult => {
			const ids = new Set(String(offer.itemIds).split(";").map(Number));
			const base = furniture.find((item) => ids.has(Number(item.id)));
			return {
				kind: "offer",
				id: Number(offer.id),
				pageId: Number(offer.pageId),
				caption: offer.caption,
				path: pagePath(Number(offer.pageId)),
				href: href(Number(offer.pageId)),
				...(base
					? {
							furniture: {
								id: Number(base.id),
								classname: base.classname,
								spriteId: Number(base.spriteId),
							},
						}
					: {}),
			};
		}),
	];
}
