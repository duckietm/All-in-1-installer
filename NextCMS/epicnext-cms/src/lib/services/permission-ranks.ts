import { type SQL, sql } from "drizzle-orm";
import { type Db, rowsFrom } from "@/lib/db";

const VALID_KEY = /^[a-z][a-z0-9_]{0,63}$/;

export const RANK_GENERAL_FIELDS = new Set([
	"rank_name",
	"hidden_rank",
	"badge",
	"job_description",
	"staff_color",
	"staff_background",
	"level",
	"room_effect",
	"log_commands",
	"prefix",
	"prefix_color",
	"auto_credits_amount",
	"auto_pixels_amount",
	"auto_gotw_amount",
	"auto_points_amount",
]);

export interface EmulatorRankSummary {
	id: number;
	rank_name: string;
	badge: string;
	level: number;
	prefix: string;
	prefix_color: string;
	hidden_rank: string;
}

export interface EmulatorRankForEdit extends EmulatorRankSummary {
	log_commands: string;
	room_effect: number;
	auto_credits_amount: number;
	auto_pixels_amount: number;
	auto_gotw_amount: number;
	auto_points_amount: number;
	permissions: Record<string, string>;
	permissionMaxValues: Record<string, number>;
}

/** Surface of `Db` used by these helpers (plain raw-SQL exec + transactions). */
type RawDb = Pick<Db, "execute" | "transaction">;

async function rawExec(db: RawDb, query: SQL | string): Promise<number> {
	const [result] = await db.execute(query);
	return result.affectedRows;
}

export function getRankPermissionColumn(rankId: number) {
	if (!Number.isInteger(rankId) || rankId <= 0 || rankId > 255) {
		throw new Error("Invalid rank id");
	}
	return `rank_${rankId}`;
}

export function toPermissionValue(value: string | number) {
	const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 0) return 0;
	return Math.min(Math.trunc(parsed), 255);
}

export function splitRankUpdateFields(fields: Record<string, string | number>) {
	const rankFields: Record<string, string | number> = {};
	const permissionFields: Record<string, number> = {};

	for (const [key, value] of Object.entries(fields)) {
		if (key === "id" || !VALID_KEY.test(key)) continue;
		if (RANK_GENERAL_FIELDS.has(key)) {
			rankFields[key] = value;
		} else {
			permissionFields[key] = toPermissionValue(value);
		}
	}

	return { rankFields, permissionFields };
}

export async function fetchEmulatorRankSummaries(
	db: RawDb,
): Promise<EmulatorRankSummary[]> {
	const rows = rowsFrom<Record<string, unknown>>(
		await db.execute(sql`
      SELECT id, rank_name, badge, level, prefix, prefix_color, hidden_rank
      FROM permission_ranks
      ORDER BY id ASC
    `),
	);

	return rows.map((row) => ({
		id: Number(row.id),
		rank_name: String(row.rank_name ?? ""),
		badge: String(row.badge ?? ""),
		level: Number(row.level ?? 1),
		prefix: String(row.prefix ?? ""),
		prefix_color: String(row.prefix_color ?? ""),
		hidden_rank: String(row.hidden_rank ?? "0"),
	}));
}

export async function fetchEmulatorRankForEdit(
	db: RawDb,
	rankId: number,
): Promise<EmulatorRankForEdit | null> {
	const rankRows = rowsFrom<Record<string, unknown>>(
		await db.execute(sql`
      SELECT id, rank_name, badge, level, prefix, prefix_color, hidden_rank,
             log_commands, room_effect, auto_credits_amount, auto_pixels_amount,
             auto_gotw_amount, auto_points_amount
      FROM permission_ranks
      WHERE id = ${rankId}
    `),
	);
	if (rankRows.length === 0) return null;

	const rankColumn = getRankPermissionColumn(rankId);
	const permissions: Record<string, string> = {};
	const permissionMaxValues: Record<string, number> = {};
	const definitionColumns = await getTableColumns(db, "permission_definitions");
	if (definitionColumns.has(rankColumn)) {
		const permissionRows = rowsFrom<{
			permission_key: string;
			max_value: number;
			value: number | string | null;
		}>(
			await db.execute(sql`
        SELECT permission_key, max_value, ${sql.raw(quoteIdentifier(rankColumn))} AS value
        FROM permission_definitions
        ORDER BY permission_key ASC
      `),
		);

		for (const permission of permissionRows) {
			permissions[permission.permission_key] = String(permission.value ?? 0);
			permissionMaxValues[permission.permission_key] = Number(
				permission.max_value ?? 1,
			);
		}
	} else {
		const legacyRows = rowsFrom<Record<string, unknown>>(
			await db.execute(
				sql`SELECT * FROM permissions WHERE id = ${rankId} LIMIT 1`,
			),
		);
		for (const [key, value] of Object.entries(legacyRows[0] ?? {})) {
			if (
				key === "id" ||
				RANK_GENERAL_FIELDS.has(key) ||
				!VALID_KEY.test(key)
			) {
				continue;
			}
			const permissionValue =
				typeof value === "string" || typeof value === "number"
					? toPermissionValue(value)
					: 0;
			permissions[key] = String(permissionValue);
			permissionMaxValues[key] = Math.max(1, permissionValue);
		}
	}

	const row = rankRows[0];
	return {
		id: Number(row.id),
		rank_name: String(row.rank_name ?? ""),
		badge: String(row.badge ?? ""),
		level: Number(row.level ?? 1),
		prefix: String(row.prefix ?? ""),
		prefix_color: String(row.prefix_color ?? ""),
		hidden_rank: String(row.hidden_rank ?? "0"),
		log_commands: String(row.log_commands ?? "0"),
		room_effect: Number(row.room_effect ?? 0),
		auto_credits_amount: Number(row.auto_credits_amount ?? 0),
		auto_pixels_amount: Number(row.auto_pixels_amount ?? 0),
		auto_gotw_amount: Number(row.auto_gotw_amount ?? 0),
		auto_points_amount: Number(row.auto_points_amount ?? 0),
		permissions,
		permissionMaxValues,
	};
}

export async function createEmulatorRank(
	db: RawDb,
	data: { rank_name: string; level: number },
): Promise<number> {
	const rows = rowsFrom<{ next_id: number }>(
		await db.execute(
			sql`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM permission_ranks`,
		),
	);
	const id = Number(rows[0]?.next_id ?? 1);
	await ensurePermissionRankColumn(db, id);
	await resetPermissionRankColumn(db, id);

	await db.transaction(async (tx) => {
		await rawExec(
			tx,
			sql`
        INSERT INTO permission_ranks (id, rank_name, level)
        VALUES (${id}, ${data.rank_name}, ${data.level})
      `,
		);
		await rawExec(
			tx,
			sql`
        INSERT INTO permissions (id, rank_name, level)
        VALUES (${id}, ${data.rank_name}, ${data.level})
        ON DUPLICATE KEY UPDATE rank_name = VALUES(rank_name), level = VALUES(level)
      `,
		);
	});

	return id;
}

export async function deleteEmulatorRank(db: RawDb, rankId: number) {
	await resetPermissionRankColumn(db, rankId);
	await db.transaction(async (tx) => {
		await rawExec(tx, sql`DELETE FROM permission_ranks WHERE id = ${rankId}`);
		await rawExec(tx, sql`DELETE FROM permissions WHERE id = ${rankId}`);
	});
}

export async function updateEmulatorRank(
	db: RawDb,
	rankId: number,
	fields: Record<string, string | number>,
) {
	const { rankFields, permissionFields } = splitRankUpdateFields(fields);

	if (Object.keys(rankFields).length > 0) {
		await updateTableFields(db, "permission_ranks", rankId, rankFields);
		await updateLegacyPermissionFields(db, rankId, rankFields);
	}

	if (Object.keys(permissionFields).length > 0) {
		await updatePermissionDefinitionValues(db, rankId, permissionFields);
		await updateLegacyPermissionFields(db, rankId, permissionFields);
	}
}

async function updateTableFields(
	db: RawDb,
	table: string,
	rankId: number,
	fields: Record<string, string | number>,
) {
	const assignments = Object.entries(fields).map(
		([key, value]) => sql`${sql.raw(quoteIdentifier(key))} = ${value}`,
	);
	return rawExec(
		db,
		sql`
      UPDATE ${sql.raw(quoteIdentifier(table))}
      SET ${sql.join(assignments, sql`, `)}
      WHERE id = ${rankId}
    `,
	);
}

async function updatePermissionDefinitionValues(
	db: RawDb,
	rankId: number,
	permissionFields: Record<string, number>,
) {
	const rankColumn = getRankPermissionColumn(rankId);
	const entries = Object.entries(permissionFields);
	const cases = entries.map(
		([key, value]) => sql`WHEN ${key} THEN LEAST(${value}, max_value)`,
	);
	const keys = entries.map(([key]) => key);

	return rawExec(
		db,
		sql`
      UPDATE permission_definitions
      SET ${sql.raw(quoteIdentifier(rankColumn))} =
        CASE permission_key
          ${sql.join(cases, sql` `)}
          ELSE ${sql.raw(quoteIdentifier(rankColumn))}
        END
      WHERE permission_key IN (${sql.join(keys, sql`, `)})
    `,
	);
}

async function updateLegacyPermissionFields(
	db: RawDb,
	rankId: number,
	fields: Record<string, string | number>,
) {
	const columns = await getTableColumns(db, "permissions");
	const existingFields = Object.fromEntries(
		Object.entries(fields).filter(([key]) => columns.has(key)),
	);
	if (Object.keys(existingFields).length === 0) return 0;
	return updateTableFields(db, "permissions", rankId, existingFields);
}

async function ensurePermissionRankColumn(db: RawDb, rankId: number) {
	const rankColumn = getRankPermissionColumn(rankId);
	const exists = rowsFrom<{ c: number }>(
		await db.execute(sql`
      SELECT COUNT(*) AS c
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'permission_definitions'
        AND column_name = ${rankColumn}
    `),
	);
	if (Number(exists[0]?.c ?? 0) > 0) return;

	await rawExec(
		db,
		sql`
      ALTER TABLE permission_definitions
      ADD COLUMN ${sql.raw(quoteIdentifier(rankColumn))} TINYINT UNSIGNED NOT NULL DEFAULT 0
    `,
	);
}

async function resetPermissionRankColumn(db: RawDb, rankId: number) {
	const rankColumn = getRankPermissionColumn(rankId);
	await rawExec(
		db,
		sql`
      UPDATE permission_definitions
      SET ${sql.raw(quoteIdentifier(rankColumn))} = 0
    `,
	);
}

async function getTableColumns(db: RawDb, table: string) {
	const rows = rowsFrom<{ column_name: string }>(
		await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ${table}
    `),
	);
	return new Set(rows.map((row) => row.column_name));
}

function quoteIdentifier(identifier: string) {
	if (!VALID_KEY.test(identifier)) throw new Error("Invalid identifier");
	return `\`${identifier}\``;
}
