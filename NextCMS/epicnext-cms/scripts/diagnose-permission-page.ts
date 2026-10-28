import "./load-env";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { mysqlConnectionUrl } from "./db-url";

type DbError = Error & { code?: string };

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const connection = await mysql.createConnection(
	mysqlConnectionUrl(databaseUrl),
);
let failed = false;

async function probe(
	name: string,
	statement: string,
	values: Array<string | number> = [],
): Promise<RowDataPacket[] | null> {
	try {
		const [rows] = await connection.execute<RowDataPacket[]>(statement, values);
		console.log(`[permissions-diag] ${name}: ok (${rows.length} rows)`);
		return rows;
	} catch (error) {
		failed = true;
		const dbError = error as DbError;
		console.error(
			`[permissions-diag] ${name}: failed code=${dbError.code ?? "unknown"} message=${dbError.message}`,
		);
		return null;
	}
}

try {
	const rankRows = await probe(
		"select rank id",
		"SELECT id FROM permission_ranks ORDER BY id DESC LIMIT 1",
	);
	const rankId = Number(rankRows?.[0]?.id ?? 11);
	console.log(`[permissions-diag] probing rank id ${rankId}`);

	await probe(
		"rank detail",
		`SELECT id, rank_name, badge, level, prefix, prefix_color, hidden_rank,
		        log_commands, room_effect, auto_credits_amount, auto_pixels_amount,
		        auto_gotw_amount, auto_points_amount
		 FROM permission_ranks WHERE id = ?`,
		[rankId],
	);

	const definitionColumns = await probe(
		"permission_definitions columns",
		`SELECT column_name FROM information_schema.columns
		 WHERE table_schema = DATABASE() AND table_name = 'permission_definitions'`,
	);
	const permissionLimits = await probe(
		"permission max_value limits",
		`SELECT MIN(max_value) AS min_value,
		        MAX(max_value) AS max_value,
		        SUM(max_value > 20) AS values_over_20
		 FROM permission_definitions`,
	);
	if (permissionLimits?.[0]) {
		console.log(
			`[permissions-diag] max_value range ${permissionLimits[0].min_value}..${permissionLimits[0].max_value}; values_over_20=${permissionLimits[0].values_over_20}`,
		);
	}

	const rankColumn = `rank_${rankId}`;
	if (definitionColumns?.some((row) => row.column_name === rankColumn)) {
		await probe(
			"normalized permissions",
			`SELECT permission_key, max_value, \`${rankColumn}\` AS value
			 FROM permission_definitions ORDER BY permission_key ASC`,
		);
	} else {
		await probe(
			"legacy permissions",
			"SELECT * FROM permissions WHERE id = ? LIMIT 1",
			[rankId],
		);
	}

	await probe(
		"rank users",
		"SELECT id, username, look FROM users WHERE rank = ? ORDER BY username LIMIT 200",
		[rankId],
	);
	await probe(
		"rank user count",
		"SELECT COUNT(*) AS total FROM users WHERE rank = ?",
		[rankId],
	);
	await probe(
		"CMS permissions",
		"SELECT id, slug, title FROM acl_permissions ORDER BY slug",
	);
	const roles = await probe(
		"CMS role",
		"SELECT id FROM acl_roles WHERE slug = ? LIMIT 1",
		[`rank_${rankId}`],
	);
	if (roles?.[0]?.id) {
		await probe(
			"CMS role permissions",
			`SELECT p.slug FROM acl_model_permissions mp
			 INNER JOIN acl_permissions p ON mp.permission_id = p.id
			 WHERE mp.model_id = ?`,
			[roles[0].id],
		);
	}
} finally {
	await connection.end();
}

if (failed) process.exitCode = 1;
