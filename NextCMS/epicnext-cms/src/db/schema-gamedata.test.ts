// @ts-nocheck
import type { MySqlIndex } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import {
	GamedataDocs,
	GamedataFurnidata,
	GamedataTexts,
} from "./schema-gamedata";

type Col = {
	name: string;
	notNull: boolean;
	primary: boolean;
	enumValues?: readonly string[];
	dataType: string;
	generated?: { mode: string };
	default?: unknown;
	hasDefault: boolean;
};

function columnsOf(t: unknown): Record<string, Col> {
	return (t as Record<symbol, unknown>)[
		Symbol.for("drizzle:Columns")
	] as Record<string, Col>;
}

function indexesOf(t: unknown): MySqlIndex[] {
	const builder = (t as Record<symbol, unknown>)[
		Symbol.for("drizzle:ExtraConfigBuilder")
	];
	if (typeof builder !== "function") return [];
	const result = (builder as (cols: unknown) => unknown)(columnsOf(t));
	return (Array.isArray(result) ? result : []) as MySqlIndex[];
}

describe("gamedata schema tables", () => {
	it("GamedataFurnidata maps to gamedata_furnidata with indexed columns", () => {
		const t = GamedataFurnidata as unknown as {
			[Symbol.for("drizzle:Name")]: string;
		};
		expect(t[Symbol.for("drizzle:Name") as never]).toBe("gamedata_furnidata");
		const cols = columnsOf(GamedataFurnidata);
		expect(cols.id).toMatchObject({ name: "id", primary: true, notNull: true });
		expect(cols.spriteId.name).toBe("sprite_id");
		expect(cols.kind.enumValues).toEqual(["s", "i", "e"]);
		expect(cols.payload.name).toBe("payload");

		const indexes = indexesOf(GamedataFurnidata);
		expect(indexes.map((i) => i.config.columns.map((c) => c.name))).toEqual([
			["source", "sprite_id"],
			["class_name"],
			["kind"],
		]);
	});

	it("GamedataDocs maps to gamedata_docs with a virtual title column", () => {
		const t = GamedataDocs as unknown as {
			[Symbol.for("drizzle:Name")]: string;
		};
		expect(t[Symbol.for("drizzle:Name") as never]).toBe("gamedata_docs");
		const cols = columnsOf(GamedataDocs);
		expect(cols.category.notNull).toBe(true);
		expect(cols.payloadSha1.name).toBe("payload_sha1");
		expect(cols.title.generated?.mode).toBe("virtual");
		expect(cols.title.notNull).toBe(true);

		const indexes = indexesOf(GamedataDocs);
		expect(indexes.map((i) => i.config.columns.map((c) => c.name))).toEqual([
			["category", "doc_key"],
			["title"],
		]);
	});

	it("GamedataTexts maps to gamedata_texts keyed by (category, text_key)", () => {
		const t = GamedataTexts as unknown as {
			[Symbol.for("drizzle:Name")]: string;
		};
		expect(t[Symbol.for("drizzle:Name") as never]).toBe("gamedata_texts");
		const cols = columnsOf(GamedataTexts);
		expect(cols.textKey.name).toBe("text_key");
		expect(cols.value.name).toBe("value");
		expect(cols.id.notNull).toBe(true);

		const indexes = indexesOf(GamedataTexts);
		expect(indexes.map((i) => i.config.columns.map((c) => c.name))).toEqual([
			["category", "text_key"],
			["text_key"],
		]);
	});

	it("exposes default values for furnidata and docs", () => {
		const furniCols = columnsOf(GamedataFurnidata);
		expect(furniCols.source.hasDefault).toBe(true);
		expect(furniCols.kind.hasDefault).toBe(true);
		const docsCols = columnsOf(GamedataDocs);
		expect(docsCols.payloadSha1.hasDefault).toBe(true);
	});
});
