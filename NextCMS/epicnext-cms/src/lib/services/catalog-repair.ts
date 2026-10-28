import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { AdminAuditLog, db, execResult, queryRows, rowsFrom } from "@/lib/db";
import {
	readFurniData,
	withFurniDataLock,
	writeFurniData,
} from "@/lib/services/furni-data";
import {
	autoPriceFurni,
	CATEGORY_PAGE,
	classifyFurni,
	getOrCreateCategoryPage,
	getOrCreateImportedParentPage,
} from "@/lib/services/furni-import";

export interface MissingCatalogEntry {
	classname: string;
	itemId: number;
	itemType: string;
	publicName?: string;
}

export interface CatalogSqlResult {
	statements: string[];
	sql: string;
	count: number;
	skipped: number;
}

function escSqlLiteral(value: string): string {
	return value.replace(/'/g, "''");
}

const VALID_IDENTIFIER = /^[a-zA-Z0-9_]+$/;

function quoteIdentifier(identifier: string): string {
	if (!VALID_IDENTIFIER.test(identifier)) throw new Error("Invalid identifier");
	return `\`${identifier}\``;
}

/**
 * Mapping of event prefix substrings (lowercase, no leading underscore) to
 * their human-readable English page labels. Covers every seasonal/holiday/event
 * abbreviation that has appeared across Habbo's history. Extend this map as new
 * prefixes surface.
 */
const EVENT_PREFIXES: Record<string, string> = {
	// Seasonal / Holiday events
	xmas: "Christmas",
	christmas: "Christmas",
	xmastree: "Christmas",
	xmasgift: "Christmas",
	xmaspresent: "Christmas",
	xmaseve: "Christmas",
	hween: "Halloween",
	halloween: "Halloween",
	hw: "Halloween",
	hall: "Halloween",
	spook: "Halloween",
	easter: "Easter",
	easterbunny: "Easter",
	val: "Valentine's Day",
	valentine: "Valentine's Day",
	valentines: "Valentine's Day",
	love: "Valentine's Day",
	heart: "Valentine's Day",
	newyear: "New Year",
	nye: "New Year",
	countdown: "New Year",
	summer: "Summer",
	summersale: "Summer",
	sun: "Summer",
	tropic: "Summer",
	tropical: "Summer",
	resort: "Summer",
	fall: "Fall",
	autumn: "Autumn",
	harvest: "Fall",
	winter: "Winter",
	snow: "Winter",
	snowman: "Winter",
	frost: "Winter",
	glacier: "Winter",
	arctic: "Winter",
	icicle: "Winter",
	carnival: "Carnival",
	festival: "Carnival",
	mardi: "Carnival",
	mardigras: "Carnival",
	fair: "Fair",
	rodeo: "Fair",
	thanksgiving: "Thanksgiving",
	stpat: "St. Patrick's Day",
	stpaddy: "St. Patrick's Day",
	green: "St. Patrick's Day",
	hanukkah: "Hanukkah",
	chanukah: "Hanukkah",
	diwali: "Diwali",
	deepavali: "Diwali",
	holiday: "Holiday",
	holidays: "Holiday",

	// Habbo-specific events
	anniversary: "Anniversary",
	anniv: "Anniversary",
	hb: "Habbo Birthday",
	hbday: "Habbo Birthday",
	birthday: "Birthday",
	habbohome: "HabboHome",
	quest: "Quest Event",
	mission: "Mission Event",
	task: "Task Event",
	challenge: "Challenge Event",
	gm: "GM Event",
	gamemaker: "GM Event",
	moderation: "Staff Event",
	staff: "Staff Event",
	club: "Habbo Club",
	hc: "Habbo Club",
	nitro: "Nitro Event",
	bingo: "Bingo",
	quiz: "Quiz",
	trivia: "Quiz",
	game: "Games",
	arcade: "Arcade",
	puzzle: "Puzzles",

	// Retro hotel / community server prefixes
	leet: "Leet",
	hubbly: "Hubbly",
	crazy: "Crazy",
	shock: "Shock",
	flash: "Flash",
	nova: "Nova",
	uber: "Uber",
	vip: "VIP",
	exclusive: "Exclusive",
	collectible: "Collectible",
	vintage: "Vintage",
	retro: "Retro",
	classic: "Classic",
	rare: "Rares",

	// Furniture categories
	room: "Room Furniture",
	wall: "Wall Items",
	floor: "Floor Items",
	wallpaper: "Wallpapers",
	tile: "Floor Tiles",
	carpet: "Carpets",
	rug: "Rugs",
	door: "Doors",
	gate: "Gates",
	stair: "Stairs",
	light: "Lighting",
	lamp: "Lighting",
	chair: "Chairs",
	table: "Tables",
	sofa: "Sofas",
	bed: "Beds",
	storage: "Storage",
	wardrobe: "Wardrobes",
	closet: "Wardrobes",
	plant: "Plants",
	flower: "Plants",
	tree: "Plants",
	bush: "Plants",
	grass: "Plants",
	sign: "Signs",
	board: "Signs",
	poster: "Posters",
	banner: "Banners",
	flag: "Flags",
	statue: "Statues",
	fountain: "Fountains",
	pond: "Ponds",
	garden: "Garden",
	kitchen: "Kitchen",
	bathroom: "Bathroom",
	bath: "Bathroom",
	book: "Books",
	shelf: "Shelves",
	bookshelf: "Bookshelves",
	cabinet: "Cabinets",
	drawer: "Drawers",
	chest: "Storage",
	box: "Storage",
	trunk: "Storage",
	crate: "Storage",

	// Pets
	pet: "Pets",
	dog: "Dogs",
	cat: "Cats",
	bird: "Birds",
	horse: "Horses",
	pig: "Pets",
	monkey: "Monkeys",
	frog: "Pets",
	bear: "Bears",
	spider: "Pets",
	bunny: "Rabbits",
	rabbit: "Rabbits",
	reptile: "Reptiles",
	lizard: "Reptiles",
	snake: "Reptiles",
	tank: "Fish Tank",
	fish: "Fish",

	// Effects / Badges
	badge: "Badges",
	effect: "Effects",
	bg: "Background",
	aura: "Auras",

	// Wired
	wired: "Wired",
	wf: "Wired",
	trigger: "Wired",

	// Credits / Exchange
	credit: "Credits",
	cf: "Credit Furniture",
	exe: "Exchange",
	diamond: "Diamonds",
	ducket: "Duckets",

	// Music
	trax: "Music",
	jukebox: "Music",
	sound: "Sound",
	record: "Records",
	stereo: "Music",
	musicdisk: "Music",
	musicdisc: "Music",

	// Clothing / Fashion
	clothing: "Clothing",
	clothes: "Clothing",
	shirt: "Shirt",
	pants: "Pants",
	shoes: "Shoes",
	hat: "Hat",
	costume: "Costumes",
	dress: "Dresses",
};

/**
 * Derive a human-readable English page caption from a furniture classname.
 * Automatically detects event prefixes (xmas2025 → "Christmas 2025") using a
 * comprehensive dictionary of Habbo event abbreviations. Handles multiple
 * separator styles (_, nothing). When no known pattern matches, returns the
 * fallback caption.
 */
function derivePageCaption(classname: string, fallback: string): string {
	const lower = classname.toLowerCase();

	// Try to extract a year from anywhere in the classname.
	const yearMatch = lower.match(/(\d{4})/);
	const year = yearMatch ? yearMatch[1] : null;

	// Check for known event prefixes. Iterate from longest prefix to shortest
	// to avoid partial matches (e.g., "hween" before "hw").
	const sortedPrefixes = Object.keys(EVENT_PREFIXES).sort(
		(a, b) => b.length - a.length,
	);

	for (const prefix of sortedPrefixes) {
		const re = new RegExp(`^${prefix.replace(/_/g, "[_]?")}(?:_)?(\\d*)`, "i");
		const m = lower.match(re);
		if (m) {
			const matchEnd = (m.index ?? 0) + m[0].length;
			const nextChar = lower[matchEnd];
			if (
				!nextChar ||
				nextChar === "_" ||
				nextChar === "." ||
				/\d/.test(nextChar)
			) {
				const event = EVENT_PREFIXES[prefix.toLowerCase()];
				return year ? `${event} ${year}` : event;
			}
		}
	}

	// Also try matching suffix patterns (e.g., "something_xmas2025").
	for (const prefix of sortedPrefixes) {
		const re = new RegExp(
			`${prefix.replace(/_/g, "[_]?")}(?:_)?(\\d{4})(_|$)`,
			"i",
		);
		const m = lower.match(re);
		if (m) {
			const event = EVENT_PREFIXES[prefix.toLowerCase()];
			return year ? `${event} ${year}` : event;
		}
	}

	return fallback;
}

/**
 * Build standalone `catalog_items` INSERT statements for items_base entries
 * that exist (with assets) but have no catalog entry yet. Ids and prices are
 * resolved the same way the app's own imports do it (autoPriceFurni + category
 * page + next catalog id), so running the SQL matches an app-managed import.
 *
 * When `organizeSql` is true, the output also contains `catalog_pages` INSERT
 * statements that organise items into sub-pages under "Imported Furniture",
 * using derived English captions by event+year (e.g. "Christmas 2025").
 */
export async function generateCatalogSql(
	entries: MissingCatalogEntry[],
	opts: { organizeSql?: boolean } = {},
): Promise<CatalogSqlResult> {
	const statements: string[] = [
		"-- AtomCMS catalog repair",
		`-- Generated ${new Date().toISOString()}`,
		`-- ${entries.length} item(s) to add`,
		"START TRANSACTION;",
	];

	const { organizeSql = false } = opts;

	// When organizing, we also emit catalog_pages INSERTs for new sub-pages.
	// Read the Imported Furniture parent page id and current max page id once.
	let parentPageId: number | null = null;
	let nextPageId = 0;
	if (organizeSql) {
		parentPageId = await getOrCreateImportedParentPage();
		const maxPageResult = await queryRows<{
			maxId: number | bigint | null;
		}>(sql`
			SELECT MAX(id) as maxId FROM catalog_pages
		`);
		nextPageId = Number(maxPageResult[0]?.maxId ?? 0) + 1;
	}

	// The generation pass does not INSERT, so MAX(id) would never advance and
	// per-entry allocateCatalogItemId would hand out the same id every time.
	// Read the current max once and hand out sequential ids from there.
	const maxIdResult = await queryRows<{ maxId: number | bigint | null }>(sql`
		SELECT MAX(id) as maxId FROM catalog_items
	`);
	let nextId = Number(maxIdResult[0]?.maxId ?? 0) + 1;

	// Skip entries whose sprite id no longer exists in items_base (e.g. because
	// a duplicate-classname merge ran between the audit snapshot and this
	// generation). Inserting them would create orphaned catalog_items rows.
	const validIds = await queryRows<{ id: number }>(sql`
		SELECT id FROM items_base
	`);
	const validItemIds = new Set(validIds.map((r) => Number(r.id)));
	let skipped = 0;

	// Build a map of caption_save → pageId so multiple items in the same
	// category share one page (and we emit the page INSERT only once).
	const pageMap = new Map<string, number>();

	let generated = 0;
	for (const entry of entries) {
		if (!validItemIds.has(entry.itemId)) {
			skipped++;
			continue;
		}
		// Re-check against the live table: the audit snapshot may be stale and
		// an import may have created the entry in the meantime. Inserting would
		// create a duplicate catalog_items row for the same item_ids.
		const existing = await queryRows<{ id: number }>(sql`
			SELECT id FROM catalog_items WHERE item_ids = ${String(entry.itemId)} LIMIT 1
		`);
		if (existing.length > 0) {
			skipped++;
			continue;
		}
		let pageId: number;
		if (organizeSql && parentPageId) {
			const catKey = classifyFurni(entry.classname, entry.itemType);
			const captionSave = `imp_${catKey}`;
			const catInfo = CATEGORY_PAGE[catKey] || CATEGORY_PAGE.other;
			const caption = derivePageCaption(
				entry.classname,
				entry.publicName ?? catInfo.label,
			);
			let existing = pageMap.get(captionSave);
			if (!existing) {
				const found = await queryRows<{ id: number }>(sql`
					SELECT id FROM catalog_pages WHERE caption_save = ${captionSave} AND parent_id = ${parentPageId}
				`);
				if (found?.[0]?.id) {
					pageMap.set(captionSave, found[0].id);
				} else {
					const newId = nextPageId++;
					pageMap.set(captionSave, newId);
					statements.push(
						`INSERT INTO catalog_pages (id, caption_save, caption, page_layout, parent_id, min_rank, order_num, icon_image, enabled, visible, includes, page_headline, page_teaser, page_special, page_text1, page_text2, page_text_details, page_text_teaser) VALUES (${newId}, '${escSqlLiteral(captionSave)}', '${escSqlLiteral(caption)}', 'default_3x3', ${parentPageId}, '1', ${catInfo.order}, ${catInfo.icon}, '1', '1', '', '', '', '', '', '', '', '');`,
					);
				}
				existing = pageMap.get(captionSave);
			}
			if (!existing) continue;
			pageId = existing;
		} else {
			try {
				pageId = await getOrCreateCategoryPage(entry.classname, entry.itemType);
			} catch {
				continue;
			}
		}
		const price = autoPriceFurni(entry.classname);
		// catalog_name must match items_base.item_name (the classname), exactly
		// like the app's own import pipeline, so the studio's in-catalog joins
		// and the emulator's item lookup stay consistent. offer_id mirrors the
		// row's own id, never a literal '-1'.
		statements.push(
			`INSERT INTO catalog_items (id, page_id, item_ids, catalog_name, cost_credits, cost_points, points_type, amount, order_number, offer_id, extradata) VALUES (${nextId}, ${pageId}, ${entry.itemId}, '${escSqlLiteral(entry.classname)}', ${price.credits}, ${price.points}, ${price.pointsType}, 1, 1, ${nextId}, '');`,
		);
		nextId++;
		generated++;
	}

	statements.push("COMMIT;");
	return { statements, sql: statements.join("\n"), count: generated, skipped };
}

/** Execute generated INSERT statements directly against the database. */
export async function applyCatalogSql(
	statements: string[],
): Promise<{ applied: number; failed: number }> {
	let applied = 0;
	let failed = 0;
	for (const statement of statements) {
		const trimmed = statement.trim();
		if (
			!trimmed ||
			trimmed.startsWith("--") ||
			trimmed === "START TRANSACTION;" ||
			trimmed === "COMMIT;"
		) {
			continue;
		}
		try {
			await db.execute(sql.raw(trimmed));
			applied++;
		} catch {
			failed++;
		}
	}
	return { applied, failed };
}

export interface OrphanedCatalogResult {
	removed: number;
	cleaned: number;
}

export interface DuplicateClassnameResult {
	merged: number;
	rowsRemoved: number;
	remapped: number;
}

/**
 * Remove catalog_items rows whose item_ids only reference non-existent
 * items_base entries, and strip orphaned ids from mixed rows. Also deletes
 * catalog_items_limited rows that pointed at the removed catalog entries so no
 * new orphans are left behind.
 */
export async function repairOrphanedCatalog(): Promise<OrphanedCatalogResult> {
	const itemRows = await queryRows<{ id: number }>(sql`
		SELECT id FROM items_base
	`);
	const valid = new Set<number>();
	for (const row of itemRows) valid.add(Number(row.id));

	const catalogRows = await queryRows<{ id: number; item_ids: string }>(sql`
		SELECT id, item_ids FROM catalog_items
	`);

	let removed = 0;
	let cleaned = 0;

	for (const row of catalogRows) {
		const ids = (row.item_ids ?? "")
			.split(";")
			.map((s) => Number(s.trim()))
			.filter(Boolean);
		if (ids.length === 0) continue;
		const kept = ids.filter((id) => valid.has(id));
		if (kept.length === ids.length) continue;

		if (kept.length === 0) {
			await db.execute(sql`
				DELETE FROM catalog_items_limited WHERE catalog_item_id = ${row.id}
			`);
			await db.execute(sql`DELETE FROM catalog_items WHERE id = ${row.id}`);
			removed++;
		} else {
			await db.execute(sql`
				UPDATE catalog_items SET item_ids = ${kept.join(";")} WHERE id = ${row.id}
			`);
			cleaned++;
		}
	}

	return { removed, cleaned };
}

/**
 * Merge duplicate classnames in items_base into a single canonical row per
 * classname, remapping every reference (catalog item id lists, player items,
 * presents, marketplace, etc.) to the canonical id, then delete the duplicate
 * rows. The canonical id is the one players actually purchase through
 * catalog_items when present, otherwise the lowest id.
 */
export async function repairDuplicateClassnames(): Promise<DuplicateClassnameResult> {
	const itemRows = await queryRows<{ id: number; item_name: string }>(sql`
		SELECT id, item_name FROM items_base
	`);

	const byName = new Map<string, number[]>();
	for (const row of itemRows) {
		const arr = byName.get(row.item_name) ?? [];
		arr.push(Number(row.id));
		byName.set(row.item_name, arr);
	}

	const catalogRows = await queryRows<{ item_ids: string }>(sql`
		SELECT item_ids FROM catalog_items
	`);
	const referenced = new Set<number>();
	for (const row of catalogRows) {
		for (const part of (row.item_ids ?? "").split(";")) {
			const id = Number(part.trim());
			if (id) referenced.add(id);
		}
	}

	const remap = new Map<number, number>();
	let merged = 0;
	for (const ids of byName.values()) {
		if (ids.length <= 1) continue;
		merged++;
		const sorted = [...ids].sort((a, b) => a - b);
		const canonical = sorted.find((id) => referenced.has(id)) ?? sorted[0];
		for (const id of ids) {
			if (id !== canonical) remap.set(id, canonical);
		}
	}

	if (remap.size === 0) return { merged: 0, rowsRemoved: 0, remapped: 0 };

	let remapped = 0;

	// Semicolon-separated item_ids columns.
	const listTables: Array<{ table: string; idCol: string }> = [
		{ table: "catalog_items", idCol: "id" },
		{ table: "catalog_items_bc", idCol: "id" },
		{ table: "logs_shop_purchases", idCol: "id" },
	];
	for (const { table, idCol } of listTables) {
		const rows = await queryRows<{ pk: number; v: string | null }>(
			sql`SELECT ${sql.raw(quoteIdentifier(idCol))} AS pk, item_ids AS v FROM ${sql.raw(quoteIdentifier(table))}`,
		);
		for (const row of rows) {
			if (!row.v) continue;
			const parts = row.v
				.split(";")
				.map((s) => s.trim())
				.filter(Boolean);
			let changed = false;
			const out: number[] = [];
			const seen = new Set<number>();
			for (const part of parts) {
				const id = Number(part);
				const mapped = remap.get(id) ?? id;
				if (mapped !== id) changed = true;
				if (seen.has(mapped)) continue;
				seen.add(mapped);
				out.push(mapped);
			}
			if (!changed) continue;
			await db.execute(
				sql`UPDATE ${sql.raw(quoteIdentifier(table))} SET item_ids = ${out.join(";")} WHERE ${sql.raw(quoteIdentifier(idCol))} = ${row.pk}`,
			);
			remapped++;
		}
	}

	// Single item_id columns that reference items_base.id. Remap in chunks via
	// a single CASE statement per table to keep the query count low even with
	// thousands of duplicate rows.
	const singleTables = [
		"catalog_items_limited",
		"items",
		"items_presents",
		"pet_items",
		"pet_foods",
		"pet_drinks",
		"items_hoppers",
		"marketplace_items",
		"items_highscore_data",
		"items_crackable",
		"builders_club_items",
		"recycler_prizes",
		"gift_wrappers",
		"youtube_playlists",
		"room_trade_log_items",
		"calendar_rewards",
		"room_trax_playlist",
		"trax_playlist",
		"website_event_prizes",
		"room_templates_items",
		"crafting_recipes_ingredients",
		"website_rare_values",
		"logs_economy",
	];

	const entries = [...remap.entries()];
	const CHUNK = 400;
	for (const table of singleTables) {
		for (let i = 0; i < entries.length; i += CHUNK) {
			const chunk = entries.slice(i, i + CHUNK);
			const cases = chunk.map(
				([dup, canonical]) => sql`WHEN ${dup} THEN ${canonical}`,
			);
			const dupList = chunk.map(([dup]) => dup);
			try {
				const result = await execResult(sql`
					UPDATE ${sql.raw(quoteIdentifier(table))}
					SET item_id = CASE item_id ${sql.join(cases, sql` `)} ELSE item_id END
					WHERE item_id IN (${sql.join(dupList, sql`, `)})
				`);
				remapped += Number(result.affectedRows ?? 0);
			} catch {
				// Table may not exist on some hotel schemas — skip it.
			}
		}
	}

	const dupIds = entries.map(([dup]) => dup);
	await db.execute(sql`
		DELETE FROM items_base WHERE id IN (${sql.join(dupIds, sql`, `)})
	`);

	return { merged, rowsRemoved: dupIds.length, remapped };
}

export interface FurniDataRepairResult {
	added: number;
	removedDuplicates: number;
	removedIdConflicts: number;
}

function buildMinimalFurniEntry(item: {
	id: number;
	item_name: string;
	public_name: string;
}): Record<string, unknown> {
	return {
		id: item.id,
		classname: item.item_name,
		revision: 0,
		category: "unknown",
		defaultdir: 0,
		xdim: 1,
		ydim: 1,
		partcolors: { color: [] },
		name: item.public_name || item.item_name,
		description: "",
		adurl: "",
		offerid: item.id,
		buyout: false,
		rentofferid: -1,
		rentbuyout: false,
		bc: false,
		excludeddynamic: false,
		customparams: "",
		specialtype: 0,
		canstandon: false,
		cansiton: false,
		canlayon: false,
		furniline: "",
		environment: "",
		rare: false,
	};
}

/**
 * Add FurnitureData.json entries for items_base rows that are missing from the
 * file, remove duplicate classnames, and resolve spriteId conflicts
 * (keeping the first classname per id, removing conflicting ones).
 */
export async function repairFurniData(
	items: Array<{
		id: number;
		item_name: string;
		public_name: string;
		type: string;
	}>,
): Promise<FurniDataRepairResult> {
	if (items.length === 0)
		return { added: 0, removedDuplicates: 0, removedIdConflicts: 0 };

	return withFurniDataLock(async () => {
		const furniData = (await readFurniData()) as Record<
			string,
			{ furnitype: Array<Record<string, unknown>> }
		>;

		// 1) Deduplicate classnames per section (keep the first occurrence).
		let removedDuplicates = 0;
		for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
			const sec = furniData[section];
			if (!sec?.furnitype) continue;
			const seen = new Set<string>();
			const deduped = sec.furnitype.filter((e) => {
				const classname = typeof e.classname === "string" ? e.classname : "";
				if (!classname) return true;
				if (seen.has(classname)) {
					removedDuplicates++;
					return false;
				}
				seen.add(classname);
				return true;
			});
			if (deduped.length !== sec.furnitype.length) {
				furniData[section].furnitype = deduped;
			}
		}

		// 2) Resolve spriteId conflicts (same id used by different classnames) — keep first, remove others.
		let removedIdConflicts = 0;
		for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
			const sec = furniData[section];
			if (!sec?.furnitype) continue;
			const idToClassname = new Map<number, string>();
			const deduped = sec.furnitype.filter((e) => {
				const id = Number(e?.id);
				const classname = typeof e.classname === "string" ? e.classname : "";
				if (!Number.isFinite(id) || id <= 0 || !classname) return true;
				const existing = idToClassname.get(id);
				if (existing && existing !== classname) {
					// Conflict: same id used by different classname — keep first, remove this
					removedIdConflicts++;
					return false;
				}
				if (!existing) {
					idToClassname.set(id, classname);
				}
				return true;
			});
			if (deduped.length !== sec.furnitype.length) {
				furniData[section].furnitype = deduped;
			}
		}

		// 3) Add entries for items_base rows missing from the file.
		const existing = new Set<string>();
		for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
			for (const e of furniData[section]?.furnitype ?? []) {
				if (typeof e.classname === "string") existing.add(e.classname);
			}
		}
		const added: Array<{ entry: Record<string, unknown>; itemType: string }> =
			[];
		for (const item of items) {
			if (existing.has(item.item_name)) continue;
			added.push({
				entry: buildMinimalFurniEntry(item),
				itemType: item.type,
			});
		}

		// 4) Write once if anything changed.
		if (removedDuplicates > 0 || removedIdConflicts > 0 || added.length > 0) {
			for (const { entry, itemType } of added) {
				const sectionKey = itemType === "i" ? "wallitemtypes" : "roomitemtypes";
				if (!furniData[sectionKey]) {
					furniData[sectionKey] = { furnitype: [] };
				}
				furniData[sectionKey].furnitype.push(entry);
			}
			await writeFurniData(furniData as Record<string, unknown>);
		}
		return { added: added.length, removedDuplicates, removedIdConflicts };
	});
}

export interface CatalogParentRepairPreview {
	fingerprint: string;
	catalog: "normal" | "bc";
	changes: import("./catalog-integrity").ParentRepair[];
}

function parentStateFingerprint(
	catalog: "normal" | "bc",
	pages: import("./catalog-integrity").IntegrityPage[],
) {
	return createHash("sha256")
		.update(JSON.stringify({ catalog, pages }))
		.digest("hex");
}

export async function previewCatalogParentRepair(
	catalog: "normal" | "bc",
): Promise<CatalogParentRepairPreview> {
	const { integrityCatalog, planParentRepairs } = await import(
		"./catalog-integrity"
	);
	integrityCatalog(catalog);
	const table = sql.raw(
		catalog === "bc" ? "catalog_pages_bc" : "catalog_pages",
	);
	const rows = await queryRows<import("./catalog-integrity").IntegrityPage>(
		sql`SELECT id, parent_id AS parentId, caption FROM ${table} ORDER BY id`,
	);
	return {
		catalog,
		fingerprint: parentStateFingerprint(catalog, rows),
		changes: planParentRepairs(rows),
	};
}

/** Locks and revalidates the complete parent graph before making the previewed changes. */
export async function applyCatalogParentRepair(
	catalog: "normal" | "bc",
	fingerprint: string,
	userId: number,
): Promise<{ applied: number }> {
	const { integrityCatalog, planParentRepairs } = await import(
		"./catalog-integrity"
	);
	integrityCatalog(catalog);
	if (!/^[a-f0-9]{64}$/.test(fingerprint))
		throw new Error("Invalid repair preview");
	const tableName = catalog === "bc" ? "catalog_pages_bc" : "catalog_pages";
	const table = sql.raw(tableName);
	return db.transaction(async (tx) => {
		const pages = rowsFrom<import("./catalog-integrity").IntegrityPage>(
			await tx.execute(
				sql`SELECT id, parent_id AS parentId, caption FROM ${table} ORDER BY id FOR UPDATE`,
			),
		);
		if (parentStateFingerprint(catalog, pages) !== fingerprint) {
			const error = new Error("Catalog changed since preview");
			error.name = "CatalogPreviewConflict";
			throw error;
		}
		const changes = planParentRepairs(pages);
		for (const change of changes) {
			await tx.execute(
				sql`UPDATE ${table} SET parent_id = ${change.to} WHERE id = ${change.id} AND parent_id = ${change.from}`,
			);
			await tx.insert(AdminAuditLog).values({
				userId,
				action: "catalog_parent_repair",
				target: tableName,
				targetId: change.id,
				before: JSON.stringify({ parentId: change.from }),
				after: JSON.stringify({ parentId: change.to }),
				diff: JSON.stringify({
					parentId: { from: change.from, to: change.to },
				}),
				createdAt: new Date().toISOString(),
			});
		}
		return { applied: changes.length };
	});
}
