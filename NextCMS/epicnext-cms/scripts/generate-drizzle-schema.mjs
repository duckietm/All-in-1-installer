#!/usr/bin/env node
// Generates src/db/schema.ts from:
//  1. existing src/db/schema.ts  -> TS export names, camelCase fields, column maps, keys
//  2. live MySQL introspection   -> real column types (DB is authoritative for DDL)
//
// The DB is owned by the Arcturus emulator; we never run drizzle-kit migrate/push.
// CMS DDL lands in drizzle/migrations/*.sql via `pnpm db:migrate`.
// drizzle-kit (`pnpm db:generate` / studio / introspect) is draft/browse tooling only.
//
// Usage: pnpm db:schema:generate
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MYSQL2_UNSUPPORTED_OPTIONS = [
	"connection_limit",
	"pool_timeout",
	"connect_timeout",
];

function mysqlConnectionUrl(value) {
	const url = new URL(value);
	for (const option of MYSQL2_UNSUPPORTED_OPTIONS)
		url.searchParams.delete(option);
	return url.toString();
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SCHEMA_TS = resolve(ROOT, "src/db/schema.ts");
const OUT = SCHEMA_TS;

// Load .env like the TS scripts do (process.loadEnvFile never overrides
// variables already present in the shell).
for (const name of [".env.local", ".env"]) {
	const file = resolve(ROOT, name);
	if (existsSync(file)) process.loadEnvFile(file);
}

// ---------- Parse existing Drizzle schema (naming source of truth) ----------
const schemaSource = readFileSync(SCHEMA_TS, "utf-8");

/**
 * @returns {{ name: string, table: string, fields: object[], ids: string[]|null, uniques: string[][] }}
 */
function parseDrizzleTables(source) {
	const models = [];
	const re2 =
		/^export const (\w+) = mysqlTable\(\s*"([^"]+)"\s*,\s*\{([\s\S]*?)\n\}(?:,\s*\(t\)\s*=>\s*\[([\s\S]*?)\])?\s*\);/gm;

	let match = re2.exec(source);
	const seen = new Set();
	while (match !== null) {
		const [, name, table, body, extras] = match;
		if (!seen.has(name)) {
			seen.add(name);
			models.push(parseTableBody(name, table, body, extras ?? ""));
		}
		match = re2.exec(source);
	}

	if (models.length === 0) {
		throw new Error(
			`[schema-gen] Failed to parse any mysqlTable exports from ${SCHEMA_TS}`,
		);
	}
	return models;
}

function parseTableBody(name, table, body, extras) {
	const fields = [];
	for (const line of body.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("//")) continue;
		const m = trimmed.match(/^(\w+)\s*:\s*(.+?),?\s*$/);
		if (!m) continue;
		const fieldName = m[1];
		const expr = m[2];
		const colMatch = expr.match(/\(\s*"([^"]+)"/);
		if (!colMatch) continue;
		const column = colMatch[1];

		const isBoolean = /\bboolean\s*\(/.test(expr);
		const enumMatch = expr.match(/mysqlEnum\s*\(\s*"[^"]+"\s*,\s*(\[[^\]]*\])/);
		let enumValues = null;
		if (enumMatch) {
			try {
				enumValues = JSON.parse(enumMatch[1].replace(/'/g, '"'));
			} catch {
				enumValues = [...enumMatch[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
			}
		}

		let defaultContent = null;
		const defIdx = expr.indexOf(".default(");
		if (defIdx >= 0) {
			const start = defIdx + ".default(".length;
			let depth = 0;
			for (let i = start; i < expr.length; i++) {
				const ch = expr[i];
				if (ch === "(") depth++;
				else if (ch === ")") {
					if (depth === 0) {
						defaultContent = expr.slice(start, i).trim();
						break;
					}
					depth--;
				}
			}
		}

		fields.push({
			fieldName,
			column,
			optional: !/\.notNull\s*\(/.test(expr),
			isId: /\.primaryKey\s*\(/.test(expr),
			isUnique: /\.unique\s*\(/.test(expr),
			autoIncrement: /\.autoincrement\s*\(/.test(expr),
			isBoolean,
			enumValues,
			defaultContent,
			// legacy shape used by columnExpr / fallback
			prismaType: isBoolean
				? "Boolean"
				: enumValues
					? fieldName === "gender"
						? "users_gender"
						: fieldName === "type" && table === "bans"
							? "bans_type"
							: "String"
					: "String",
			attrs: defaultContent ? `@default(${defaultContent})` : "",
			dbHint: null,
		});
	}

	let ids = null;
	const uniques = [];
	if (extras) {
		const pk = extras.match(
			/primaryKey\(\s*\{\s*columns:\s*\[([^\]]+)\]\s*\}\s*\)/,
		);
		if (pk) {
			ids = [...pk[1].matchAll(/t\.(\w+)/g)].map((m) => m[1]);
		}
		for (const u of extras.matchAll(/uniqueIndex\([^)]*\)\.on\(([^)]+)\)/g)) {
			uniques.push([...u[1].matchAll(/t\.(\w+)/g)].map((m) => m[1]));
		}
	}

	return { name, table, fields, ids, uniques };
}

const models = parseDrizzleTables(schemaSource);

// ---------- Introspect live MySQL ----------
let url;
try {
	const raw = process.env.DATABASE_URL;
	if (!raw) throw new Error("DATABASE_URL is required");
	url = mysqlConnectionUrl(raw);
} catch (err) {
	console.error("[schema-gen] No DATABASE_URL:", err.message);
	process.exit(1);
}
const mysql = await import("mysql2/promise");
const conn = await mysql.createConnection(url);

const [cols] = await conn.query(
	`SELECT table_name, column_name, data_type, column_type, is_nullable,
	        column_key, column_default, extra
	   FROM information_schema.columns
	  WHERE table_schema = DATABASE()`,
);
await conn.end();

const colByTable = new Map();
for (const c of cols) {
	const key = `${c.table_name}.${c.column_name}`;
	colByTable.set(key, c);
}

// ---------- Build drizzle column builders ----------
const used = new Set(["mysqlTable", "primaryKey", "uniqueIndex", "customType"]);
let usedSql = false;

function use(name) {
	used.add(name);
}

function markSqlUsed() {
	usedSql = true;
}

function quote(v) {
	return `"${String(v).replace(/"/g, '\\"')}"`;
}

/** Map a DB column row to a drizzle column expression string. */
function columnExpr(field, dbCol) {
	const col = field.column;
	let type = "";

	const unsigned = /unsigned/.test(dbCol?.column_type ?? "");
	const decimalMatch = dbCol?.column_type?.match(/decimal\((\d+),(\d+)\)/);
	const enumMatch = dbCol?.column_type?.match(/^enum\((.+)\)$/);

	if (field.prismaType === "users_gender" || field.prismaType === "bans_type") {
		use("mysqlEnum");
		const values = enumMatch
			? [...enumMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
			: (field.enumValues ??
				(field.prismaType === "users_gender"
					? ["M", "F"]
					: ["account", "ip", "machine", "super"]));
		return `mysqlEnum(${quote(col)}, ${JSON.stringify(values)})`;
	}

	switch (dbCol?.data_type) {
		case "int":
			use("int");
			type = unsigned
				? `int(${quote(col)}, { unsigned: true })`
				: `int(${quote(col)})`;
			break;
		case "tinyint": {
			const isBool =
				dbCol.column_type === "tinyint(1)" &&
				(field.isBoolean || field.prismaType === "Boolean");
			if (isBool) {
				use("boolean");
				type = `boolean(${quote(col)})`;
			} else {
				use("tinyint");
				type = unsigned
					? `tinyint(${quote(col)}, { unsigned: true })`
					: `tinyint(${quote(col)})`;
			}
			break;
		}
		case "smallint":
			use("smallint");
			type = unsigned
				? `smallint(${quote(col)}, { unsigned: true })`
				: `smallint(${quote(col)})`;
			break;
		case "mediumint":
			use("mediumint");
			type = unsigned
				? `mediumint(${quote(col)}, { unsigned: true })`
				: `mediumint(${quote(col)})`;
			break;
		case "bigint":
			use("bigint");
			type = `bigint(${quote(col)}, { mode: "bigint", unsigned: ${unsigned} })`;
			break;
		case "varchar":
		case "enum": {
			use("varchar");
			const maxLen = enumMatch
				? Math.max(
						...[...enumMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1].length),
						1,
					)
				: Number(dbCol?.column_type?.match(/\((\d+)\)/)?.[1] ?? 255);
			type = `varchar(${quote(col)}, { length: ${maxLen} })`;
			break;
		}
		case "char":
			use("char");
			type = `char(${quote(col)}, { length: ${Number(dbCol?.column_type?.match(/\((\d+)\)/)?.[1] ?? 8)} })`;
			break;
		case "text":
			use("text");
			type = `text(${quote(col)})`;
			break;
		case "mediumtext":
			use("mediumtext");
			type = `mediumtext(${quote(col)})`;
			break;
		case "longtext":
			use("longtext");
			type = `longtext(${quote(col)})`;
			break;
		case "datetime": {
			use("datetime");
			const fsp = dbCol.column_type.match(/datetime\((\d+)\)/)?.[1];
			type = fsp
				? `datetime(${quote(col)}, { fsp: ${Number(fsp)} })`
				: `datetime(${quote(col)})`;
			break;
		}
		case "timestamp": {
			use("timestamp");
			const fsp = dbCol.column_type.match(/timestamp\((\d+)\)/)?.[1];
			type = fsp
				? `timestamp(${quote(col)}, { fsp: ${Number(fsp)} })`
				: `timestamp(${quote(col)})`;
			break;
		}
		case "double":
			use("double");
			type = `double(${quote(col)})`;
			break;
		case "float":
			use("float");
			type = `float(${quote(col)})`;
			break;
		case "decimal":
			use("decimal");
			type = `decimal(${quote(col)}, { precision: ${Number(decimalMatch?.[1] ?? 10)}, scale: ${Number(decimalMatch?.[2] ?? 0)}, mode: "number" })`;
			break;
		case "json":
			use("json");
			type = `json(${quote(col)})`;
			break;
		case "date":
			type = `dateAsDate(${quote(col)})`;
			break;
		case "time":
			type = `timeAsDate(${quote(col)})`;
			break;
		case "blob":
		case "tinyblob":
		case "mediumblob":
		case "longblob":
			use("binary");
			type = `binary(${quote(col)})`;
			break;
		default:
			console.warn(
				`[schema-gen] WARN unhandled DB type "${dbCol?.data_type}" for ${col}`,
			);
			use("varchar");
			type = `varchar(${quote(col)}, { length: 255 })`;
	}

	return type;
}

function modifiers(field, dbCol) {
	let expr = "";
	if (dbCol?.extra?.includes("auto_increment") || field.autoIncrement) {
		expr += `.autoincrement()`;
	}
	if (field.isId) {
		expr += `.primaryKey()`;
	} else if (dbCol?.column_key === "UNI" && !field.isUnique) {
		expr += `.unique()`;
	} else if (field.isUnique) {
		expr += `.unique()`;
	}
	if (!field.optional) {
		expr += `.notNull()`;
	}
	expr += emitDefault(field, dbCol);
	return expr;
}

function emitDefault(field, dbCol) {
	const content = field.defaultContent;
	if (!content) return "";
	if (
		content === "sql`CURRENT_TIMESTAMP`" ||
		content.includes("CURRENT_TIMESTAMP")
	) {
		markSqlUsed();
		return `.default(sql\`CURRENT_TIMESTAMP\`)`;
	}
	if (content === "true" || content === "false") return `.default(${content})`;
	if (/^-?\d+n$/.test(content)) return `.default(${content})`;
	if (/^-?\d+$/.test(content)) {
		return dbCol?.data_type === "bigint"
			? `.default(${content}n)`
			: `.default(${content})`;
	}
	if (/^-?\d+\.\d+$/.test(content)) return `.default(${content})`;
	if (
		(content.startsWith('"') && content.endsWith('"')) ||
		(content.startsWith("'") && content.endsWith("'"))
	) {
		return `.default(${JSON.stringify(content.slice(1, -1))})`;
	}
	return `.default(${content})`;
}

function modelTable(model) {
	const rows = [];
	for (const f of model.fields) {
		const dbCol = colByTable.get(`${model.table}.${f.column}`);
		if (!dbCol) {
			const fallback = fallbackColumn(f) + modifiers(f, null);
			rows.push(`\t${f.fieldName}: ${fallback},`);
			console.warn(
				`[schema-gen] WARN ${model.table}.${f.column} (${f.fieldName}) missing in DB, used fallback`,
			);
			continue;
		}
		rows.push(
			`\t${f.fieldName}: ${columnExpr(f, dbCol)}${modifiers(f, dbCol)},`,
		);
	}

	const uniqueRows = [];
	if (model.ids) {
		const idCols = model.ids
			.map((n) => model.fields.find((f) => f.fieldName === n || f.column === n))
			.filter(Boolean)
			.map((f) => `t.${f.fieldName}`);
		if (idCols.length)
			uniqueRows.push(`\tprimaryKey({ columns: [${idCols.join(", ")}] }),`);
	}
	for (const u of model.uniques) {
		const cols = u
			.map((n) => model.fields.find((f) => f.fieldName === n || f.column === n))
			.filter(Boolean)
			.map((f) => `t.${f.fieldName}`);
		if (cols.length)
			uniqueRows.push(
				`\tuniqueIndex("${model.table}_${u.join("_")}").on(${cols.join(", ")}),`,
			);
	}

	if (uniqueRows.length) {
		return `export const ${model.name} = mysqlTable(
	"${model.table}",
	{
${rows.join("\n")}
	},
	(t) => [
${uniqueRows.join("\n")}
	],
);`;
	}
	return `export const ${model.name} = mysqlTable("${model.table}", {
${rows.join("\n")}
});`;
}

function fallbackColumn(field) {
	const name = field.column;
	if (field.enumValues) {
		use("mysqlEnum");
		return `mysqlEnum(${quote(name)}, ${JSON.stringify(field.enumValues)})`;
	}
	if (field.isBoolean || field.prismaType === "Boolean") {
		use("boolean");
		return `boolean(${quote(name)})`;
	}
	use("varchar");
	return `varchar(${quote(name)}, { length: 255 })`;
}

// ---------- Generate file ----------
const body = models.map(modelTable).join("\n\n");

const IMPORTABLE = [
	"bigint",
	"binary",
	"boolean",
	"char",
	"customType",
	"date",
	"datetime",
	"decimal",
	"double",
	"float",
	"int",
	"json",
	"longtext",
	"mediumint",
	"mediumtext",
	"mysqlEnum",
	"mysqlTable",
	"primaryKey",
	"smallint",
	"text",
	"time",
	"timestamp",
	"tinyint",
	"uniqueIndex",
	"varchar",
];
const importList = IMPORTABLE.filter((b) => used.has(b));

const helpers = [
	"// MySQL TIME / DATE columns are hydrated as JS Date (epoch 1970-01-01",
	"// for TIME). Keep this so existing call sites stay unchanged.",
	"const timeAsDate = customType<{ data: Date; driverData: string }>({",
	"	dataType() {",
	'		return "time";',
	"	},",
	"	toDriver(value) {",
	"		return value.toISOString().slice(11, 19);",
	"	},",
	"	fromDriver(value) {",
	// biome-ignore lint/suspicious/noTemplateCurlyInString: code generation template literal
	"		return new Date(`1970-01-01T${value}Z`);",
	"	},",
	"});",
	"",
	"const dateAsDate = customType<{ data: Date; driverData: string }>({",
	"	dataType() {",
	'		return "date";',
	"	},",
	"	toDriver(value) {",
	"		return value.toISOString().slice(0, 10);",
	"	},",
	"	fromDriver(value) {",
	// biome-ignore lint/suspicious/noTemplateCurlyInString: code generation template literal
	"		return new Date(`${value}T00:00:00Z`);",
	"	},",
	"});",
	"",
	"",
].join("\n");

const sqlImport = usedSql ? 'import { sql } from "drizzle-orm";\n' : "";

const out = `// AUTO-GENERATED by scripts/generate-drizzle-schema.mjs — DO NOT EDIT.
// TS field names come from the previous src/db/schema.ts; column types from the
// live MySQL DB. Run \`pnpm db:schema:generate\` after schema/map changes.
${sqlImport}import {
${importList.map((b) => `\t${b},`).join("\n")}
} from "drizzle-orm/mysql-core";

${helpers}${body}
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);
console.log(`[schema-gen] Wrote ${OUT} (${models.length} tables)`);
