import "./load-env";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { readFurniData, writeFurniData } from "@/lib/services/furni-data";

/**
 * Make FurnitureData.json the single source of truth for items_base ids.
 *
 * 1. Duplicate ids inside furnidata (same id claimed by several classnames)
 *    are resolved globally and iteratively: the claimant matching the current
 *    DB occupant keeps the id; losing entries are patched in the file back to
 *    their own classname's DB id (and lose their claim).
 * 2. Every items_base row is then moved (pass-based PK swap, cascading into
 *    every referencing table) to its furnidata id. Moves whose target is
 *    still occupied wait for a later pass; cycles break via scratch ids;
 *    rows squatting on a contested id without any furnidata entry are
 *    displaced to fresh ids past the global maximum.
 * 3. sprite_id = id and catalog_name = item_name afterwards.
 *
 * Run with --apply to write; without it, only reports.
 */
const APPLY = process.argv.includes("--apply");

interface Entry {
	id: number;
	classname: string;
	offerid?: unknown;
}

async function main(): Promise<void> {
	const t0 = Date.now();
	const furniData = (await readFurniData()) as Record<
		string,
		{ furnitype?: Entry[] }
	>;

	const [rows] = (await db.execute(
		sql`SELECT id, item_name FROM items_base`,
	)) as unknown as [Array<{ id: number; item_name: string }>, unknown];
	console.log(`[align] items_base rows: ${rows.length}`);
	const nameById = new Map<number, string>();
	const idByName = new Map<string, number>();
	for (const r of rows) {
		nameById.set(r.id, r.item_name);
		idByName.set(r.item_name, r.id);
	}

	const allEntries: Array<{ section: string; e: Entry }> = [];
	for (const section of ["roomitemtypes", "wallitemtypes"] as const) {
		for (const e of furniData[section]?.furnitype ?? []) {
			if (typeof e?.classname === "string" && Number.isFinite(Number(e?.id))) {
				allEntries.push({ section, e });
			}
		}
	}

	// ── global iterative duplicate-id resolution ────────────────────
	const desired = new Map<string, number>(); // classname -> furnidata id claim
	for (const { e } of allEntries) {
		const cn = e.classname;
		const id = Number(e.id);
		if (!cn || !Number.isFinite(id) || id <= 0 || desired.has(cn)) continue;
		desired.set(cn, id);
	}
	console.log(`[align] furnidata classnames: ${desired.size}`);

	const losers: Array<{ cn: string; keepId: number }> = [];
	for (;;) {
		const claimsById = new Map<number, string[]>();
		for (const [cn, id] of desired) {
			const arr = claimsById.get(id) ?? [];
			arr.push(cn);
			claimsById.set(id, arr);
		}
		let found = false;
		for (const [id, claimants] of [...claimsById].sort((a, b) => a[0] - b[0])) {
			if (claimants.length < 2) continue;
			const live = claimants.filter((cn) => desired.get(cn) === id);
			if (live.length < 2) continue;
			found = true;
			const dbHolder = nameById.get(id);
			const winner =
				dbHolder !== undefined && live.includes(dbHolder) ? dbHolder : live[0];
			for (const cn of live) {
				if (cn === winner) continue;
				const keep = idByName.get(cn);
				if (keep !== undefined && keep !== id)
					losers.push({ cn, keepId: keep });
				desired.delete(cn); // loser loses its claim entirely
			}
		}
		if (!found) break;
	}
	console.log(
		`[align] duplicate-id losers (patched to their own DB id): ${losers.length}`,
	);

	// ── compute moves ───────────────────────────────────────────────
	let fresh =
		Math.max(
			rows.reduce((m, r) => Math.max(m, r.id), 0),
			[...desired.values()].reduce((m, v) => Math.max(m, v), 0),
			losers.reduce((m, l) => Math.max(m, l.keepId), 0),
		) + 1000;

	const moves = new Map<number, number>(); // old_id -> new_id
	for (const r of rows) {
		const target = desired.get(r.item_name);
		if (target !== undefined && target !== r.id) moves.set(r.id, target);
	}
	// squatter displacement: a row occupying a contested id with no furnidata
	// entry of its own must make room
	for (;;) {
		const destCount = new Map<number, number>();
		for (const [, t] of moves) destCount.set(t, (destCount.get(t) ?? 0) + 1);
		let changed = false;
		for (const [, target] of moves) {
			const holder = nameById.get(target);
			if (holder === undefined) continue; // free
			if (moves.has(target)) continue; // vacated by its own move
			if (desired.get(holder) === target) continue; // legit stayer
			moves.set(target, fresh++);
			changed = true;
			break;
		}
		if (!changed) break;
	}
	// drop moves onto ids that a legit stayer keeps forever
	for (;;) {
		let changed = false;
		for (const [oldId, target] of moves) {
			const holder = nameById.get(target);
			if (holder === undefined || moves.has(target)) continue;
			if (desired.get(holder) === target) {
				moves.delete(oldId);
				changed = true;
				break;
			}
		}
		if (!changed) break;
	}
	console.log(`[align] planned id moves: ${moves.size}`);
	let n = 0;
	for (const [oldId, target] of moves) {
		if (n++ >= 10) break;
		console.log(`    '${nameById.get(oldId)}' : ${oldId} -> ${target}`);
	}

	if (!APPLY) {
		console.log("[align] DRY RUN — rerun with --apply to execute");
		await db.$client.end();
		process.exit(0);
	}

	// ── patch losing furnidata entries back to their DB id ──────────
	if (losers.length > 0) {
		const keepByClass = new Map(losers.map((l) => [l.cn, l.keepId]));
		for (const { e } of allEntries) {
			const keep = keepByClass.get(e.classname);
			if (keep !== undefined && Number(e.id) !== keep) {
				e.id = keep;
				e.offerid = keep;
			}
		}
		await writeFurniData(furniData as Record<string, unknown>);
		console.log(`[align] furnidata patched: ${losers.length} losing entries`);
	}

	// ── pass-based PK moves (values stay in unsigned range) ─────────
	await db.execute(sql`DROP TABLE IF EXISTS _id_map`);
	await db.execute(sql`DROP TABLE IF EXISTS _id_map_pass`);
	await db.execute(sql`
    CREATE TABLE _id_map_pass (
      old_id INT PRIMARY KEY,
      new_id INT NOT NULL,
      UNIQUE KEY uniq_new (new_id)
    ) ENGINE=InnoDB`);

	const intCols: Array<[string, string]> = [
		["items", "item_id"],
		["room_templates_items", "item_id"],
		["catalog_items_limited", "item_id"],
		["crafting_recipes_ingredients", "item_id"],
		["items_crackable", "item_id"],
		["gift_wrappers", "sprite_id"],
		["gift_wrappers", "item_id"],
		["trax_playlist", "item_id"],
		["pet_drinks", "item_id"],
		["pet_foods", "item_id"],
		["pet_items", "item_id"],
		["marketplace_items", "item_id"],
		["calendar_rewards", "item_id"],
		["builders_club_items", "item_id"],
		["youtube_playlists", "item_id"],
		["room_trax_playlist", "item_id"],
		["recycler_prizes", "item_id"],
		["website_event_prizes", "item_id"],
		["website_rare_values", "item_id"],
		["catalog_products", "item_id"],
		["room_trade_log_items", "item_id"],
		["logs_economy", "item_id"],
	];
	const strCols: Array<[string, string]> = [
		["catalog_items", "item_ids"],
		["catalog_items_bc", "item_ids"],
		["logs_shop_purchases", "item_ids"],
		["catalog_version_offers", "item_ids"],
	];

	const [csRows] = (await db.execute(sql`
    SELECT TABLE_NAME, COLUMN_NAME, CHARACTER_SET_NAME, COLLATION_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND ((TABLE_NAME = 'catalog_items' AND COLUMN_NAME = 'item_ids')
        OR (TABLE_NAME = 'catalog_items_bc' AND COLUMN_NAME = 'item_ids')
        OR (TABLE_NAME = 'logs_shop_purchases' AND COLUMN_NAME = 'item_ids')
        OR (TABLE_NAME = 'catalog_version_offers' AND COLUMN_NAME = 'item_ids'))
  `)) as unknown as [
		Array<{
			TABLE_NAME: string;
			COLUMN_NAME: string;
			CHARACTER_SET_NAME: string;
			COLLATION_NAME: string;
		}>,
		unknown,
	];
	const collationByCol = new Map<string, [string, string]>();
	for (const r of csRows ?? []) {
		collationByCol.set(`${r.TABLE_NAME}.${r.COLUMN_NAME}`, [
			r.CHARACTER_SET_NAME,
			r.COLLATION_NAME,
		]);
	}
	// numeric -> string in the target column's own charset/collation so the
	// JOIN comparison never mixes collations (CAST alone yields utf8mb4)
	const numToStr = (table: string, col: string, expr: string) => {
		const info = collationByCol.get(`${table}.${col}`);
		if (!info) return sql.raw(`CAST(${expr} AS CHAR)`);
		return sql.raw(
			`CONVERT(${expr}, CHAR CHARACTER SET ${info[0]}) COLLATE ${info[1]}`,
		);
	};

	const occupiedIds = new Set(rows.map((r) => r.id));
	let scratch = fresh;

	async function execPass(pairs: Array<[number, number]>): Promise<void> {
		if (pairs.length === 0) return;
		await db.transaction(async (tx) => {
			await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
			for (let i = 0; i < pairs.length; i += 500) {
				const chunk = pairs.slice(i, i + 500);
				await tx.execute(sql`
          INSERT INTO _id_map_pass (old_id, new_id)
          VALUES ${sql.join(
						chunk.map(([o, nw]) => sql`(${o}, ${nw})`),
						sql`, `,
					)}`);
			}

			await tx.execute(sql`
        UPDATE items_base b JOIN _id_map_pass m ON b.id = m.old_id
          SET b.id = m.new_id`);
			for (const [table, col] of intCols) {
				await tx.execute(sql`
          UPDATE ${sql.raw(table)} t JOIN _id_map_pass m
            ON t.${sql.raw(col)} = m.old_id
            SET t.${sql.raw(col)} = m.new_id`);
			}
			for (const [table, col] of strCols) {
				await tx.execute(sql`
          UPDATE ${sql.raw(table)} t JOIN _id_map_pass m
            ON t.${sql.raw(col)} = ${numToStr(table, col, "m.old_id")}
            SET t.${sql.raw(col)} = CAST(m.new_id AS CHAR)`);
			}
			for (const [o] of pairs) {
				await tx.execute(sql`DELETE FROM _id_map_pass WHERE old_id = ${o}`);
			}
			await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
		});
		for (const [o, nw] of pairs) {
			occupiedIds.delete(o);
			occupiedIds.add(nw);
		}
	}

	const pending = new Map(moves);
	let passes = 0;
	while (pending.size > 0) {
		passes++;
		const safe: Array<[number, number]> = [];
		for (const [oldId, target] of pending) {
			if (!occupiedIds.has(target)) safe.push([oldId, target]);
		}
		if (safe.length === 0) {
			// cycle: park the smallest row on a scratch id to break it
			const oldest = [...pending.keys()].sort((a, b) => a - b)[0];
			const target = pending.get(oldest);
			if (target === undefined) break;
			pending.delete(oldest);
			await execPass([[oldest, scratch]]);
			pending.set(scratch, target);
			scratch++;
			continue;
		}
		await execPass(safe);
		for (const [oldId] of safe) pending.delete(oldId);
		console.log(
			`[align] pass ${passes}: moved ${safe.length} ids (${pending.size} left)`,
		);
	}

	await db.execute(sql`DROP TABLE _id_map_pass`);

	await db.transaction(async (tx) => {
		await tx.execute(
			sql`UPDATE items_base SET sprite_id = id WHERE sprite_id <> id`,
		);
		const [res] = (await tx.execute(sql`
      UPDATE catalog_items ci JOIN items_base ib
        ON ci.item_ids = ${numToStr("catalog_items", "item_ids", "ib.id")}
        SET ci.catalog_name = ib.item_name
        WHERE ci.catalog_name <> ib.item_name`)) as unknown as [
			Record<string, unknown>,
			unknown,
		];
		console.log(
			`[align] catalog_name normalized rows: ${Number(res.affectedRows ?? 0)}`,
		);
	});

	const [maxRows] = (await db.execute(
		sql`SELECT COALESCE(MAX(id), 0) + 1 AS nxt FROM items_base`,
	)) as unknown as [Array<{ nxt: number }>, unknown];
	await db.execute(
		sql`ALTER TABLE items_base AUTO_INCREMENT = ${sql.raw(String(Number(maxRows[0]?.nxt ?? 1)))}`,
	);

	// leftover compound lists ("a;b") containing moved ids
	const [compound] = (await db.execute(sql`
    SELECT id, item_ids FROM catalog_items WHERE item_ids LIKE '%;%'
  `)) as unknown as [Array<{ id: number; item_ids: string }>, unknown];
	for (const row of compound) {
		const mapped = String(row.item_ids)
			.split(/[;,]/)
			.map((p) => {
				const v = Number(p.trim());
				return Number.isFinite(v) ? v : p;
			})
			.join(";");
		await db.execute(
			sql`UPDATE catalog_items SET item_ids = ${mapped} WHERE id = ${row.id}`,
		);
	}
	console.log(`[align] compound item_ids rewritten: ${compound.length}`);
	console.log(`[align] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

	await db.$client.end();
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
