// Gamedata / large-JSON storage schema for MariaDB.
//
// MariaDB's JSON type is an alias for LONGTEXT (+ a `CHECK (json_valid(...))`
// constraint), so it can NEVER be indexed directly. The "smart" pattern:
//   1. keep the raw JSON document in longtext / mediumtext — full fidelity,
//      no validation overhead, no 4 GB fetch if only a key is needed;
//   2. promote the fields you actually WHERE/ORDER BY into real columns;
//   3. index those columns (optionally as VIRTUAL generated columns using
//      JSON_EXTRACT so you don't duplicate data in the seed script).
//
// Not part of drizzle's auto-generated src/db/schema.ts (which is regenerated
// from the live emulator DB) — this file is a standalone schema module you
// pass to `drizzle(conn, { schema })` in bulk scripts or import directly.

import { sql } from "drizzle-orm";
import {
	index,
	int,
	longtext,
	mediumtext,
	mysqlEnum,
	mysqlTable,
	uniqueIndex,
	varchar,
} from "drizzle-orm/mysql-core";

// ── Furnidata: one row per furniture/clothing item ───────────────────────────
// Compatible with the habbo furnidata_json shape:
//   { "roomitemtypes": { "furnitype": [ { id, classname, public_name, ... } ] },
//     "wallitemtypes": { "furnitype": [ ... ] },
//     "effecttypes":  { "effecttype": [ ... ] } }
export const GamedataFurnidata = mysqlTable(
	"gamedata_furnidata",
	{
		id: int("id", { unsigned: true }).autoincrement().primaryKey().notNull(),
		source: varchar("source", { length: 64 }).notNull().default("habbo"),
		spriteId: int("sprite_id", { unsigned: true }).notNull(),
		// "s" = floor/room item, "i" = wall item, "e" = clothing/effect.
		kind: mysqlEnum("kind", ["s", "i", "e"]).notNull().default("s"),
		className: varchar("class_name", { length: 128 }).notNull(),
		// Promoted from JSON so hot lookups & LIST/WHERE never touch the blob.
		publicName: varchar("public_name", { length: 128 }).notNull().default(""),
		// Raw JSON document, kept intact for exact round-trips (catalog export).
		payload: longtext("payload").notNull(),
	},
	(t) => [
		// Idempotent seeds upsert on this key (source, sprite_id).
		uniqueIndex("gamedata_furnidata_source_sprite").on(t.source, t.spriteId),
		index("gamedata_furnidata_class").on(t.className),
		index("gamedata_furnidata_kind").on(t.kind),
	],
);

// ── Generic JSON document store ───────────────────────────────────────────────
// Use for any >50 MB JSON dump split into per-key documents (external_texts,
// product data, achievements, etc.). `title` is a VIRTUAL generated column
// extracted from the payload via JSON_EXTRACT and indexed — MariaDB supports
// secondary indexes on virtual columns (10.2+), so filtering by a payload
// field stays fast without storing a duplicate copy.
export const GamedataDocs = mysqlTable(
	"gamedata_docs",
	{
		id: int("id", { unsigned: true }).autoincrement().primaryKey().notNull(),
		category: varchar("category", { length: 64 }).notNull(),
		docKey: varchar("doc_key", { length: 128 }).notNull(),
		payload: longtext("payload").notNull(),
		// SHA-1 of the raw payload → cheap change detection on re-runs.
		payloadSha1: varchar("payload_sha1", { length: 40 }).notNull().default(""),
		// VIRTUAL (default) column; the JSON_EXTRACT runs at query/index time.
		// NOT NULL forces the extract to resolve — use .notNull() only when
		// every document guarantees the field.
		title: varchar("title", { length: 255 })
			.generatedAlwaysAs(
				sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.title')) AS CHAR(255))`,
				{ mode: "virtual" },
			)
			.notNull(),
	},
	(t) => [
		uniqueIndex("gamedata_docs_cat_key").on(t.category, t.docKey),
		index("gamedata_docs_title").on(t.title),
	],
);

// ── Key/value texts (external_texts style, split by category) ───────────────
// One row per string; bulk-loads stay resumable via (category, text_key).
export const GamedataTexts = mysqlTable(
	"gamedata_texts",
	{
		id: int("id", { unsigned: true }).autoincrement().primaryKey().notNull(),
		category: varchar("category", { length: 64 }).notNull(),
		textKey: varchar("text_key", { length: 255 }).notNull(),
		value: mediumtext("value").notNull(),
	},
	(t) => [
		uniqueIndex("gamedata_texts_cat_key").on(t.category, t.textKey),
		index("gamedata_texts_key").on(t.textKey),
	],
);

export type GamedataFurnidataRow = typeof GamedataFurnidata.$inferSelect;
export type GamedataFurnidataInsert = typeof GamedataFurnidata.$inferInsert;
export type GamedataDocsRow = typeof GamedataDocs.$inferSelect;
export type GamedataDocsInsert = typeof GamedataDocs.$inferInsert;
export type GamedataTextsRow = typeof GamedataTexts.$inferSelect;
export type GamedataTextsInsert = typeof GamedataTexts.$inferInsert;
