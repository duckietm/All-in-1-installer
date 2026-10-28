import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { is, SQL } from "drizzle-orm";
import {
	getTableConfig,
	MySqlDialect,
	type MySqlTable,
} from "drizzle-orm/mysql-core";
import { bcrypt } from "hash-wasm";
import mysql, { type Connection } from "mysql2/promise";
import { splitSqlStatements } from "../../scripts/sql-statements";
import * as schema from "../../src/db/schema";

export const STAFF_ID = 7;
export const STAFF_USERNAME = "NewsEditor";

// Use the actual ORM definitions for the emulator tables this browser journey reads.
// CMS recovery/outbox tables below come from the shipped migrations themselves.
const tables: MySqlTable[] = [
	schema.User,
	schema.Ban,
	schema.WebsiteSetting,
	schema.WebsiteLanguages,
	schema.AclRole,
	schema.AclPermission,
	schema.AclModelRole,
	schema.AclModelPermission,
	schema.WebsiteArticles,
	schema.WebsiteArticleComments,
	schema.WebsiteArticleReactions,
	schema.WebsiteLoginLogs,
	schema.AdminAuditLog,
	schema.StaffActivities,
	schema.WebsiteIpBlacklist,
	schema.WebsiteIpWhitelist,
	schema.AlertLogs,
	schema.ThemeScope,
	schema.ThemeScopeValue,
	schema.UsersCurrency,
	schema.MessengerFriendrequests,
	schema.MessengerFriendships,
	schema.MessengerOffline,
	schema.Rooms,
	schema.UsersBadges,
	schema.UsersSettings,
	schema.UserReferrals,
	schema.WebsiteEvent,
	schema.WebsiteEventType,
];
const identifier = (name: string) => `\`${name.replaceAll("`", "``")}\``;

export function fixtureStatements(): string[] {
	const dialect = new MySqlDialect();
	return tables.map((table) => {
		const config = getTableConfig(table);
		// Fail on new constraints instead of silently reducing the fixture's integrity.
		if (
			config.foreignKeys.length ||
			config.checks.length ||
			config.uniqueConstraints.length
		)
			throw Error(`Fixture requires explicit constraints for ${config.name}`);
		const columns = config.columns.map((column) => {
			let ddl = `${identifier(column.name)} ${column.getSQLType()}`;
			ddl += column.notNull ? " NOT NULL" : " NULL";
			if ("autoIncrement" in column && column.autoIncrement)
				ddl += " AUTO_INCREMENT";
			if (column.primary) ddl += " PRIMARY KEY";
			if (column.isUnique) ddl += " UNIQUE";
			if (column.default !== undefined) {
				if (is(column.default, SQL)) {
					const query = dialect.sqlToQuery(column.default);
					if (query.params.length)
						throw Error(
							`Fixture requires parameterized default for ${config.name}.${column.name}`,
						);
					ddl += ` DEFAULT ${query.sql}`;
				} else if (
					typeof column.default === "string" ||
					typeof column.default === "number" ||
					typeof column.default === "boolean" ||
					column.default === null
				)
					ddl += ` DEFAULT ${mysql.escape(column.default)}`;
				else
					throw Error(
						`Fixture requires explicit default for ${config.name}.${column.name}`,
					);
			} else if (!column.notNull) ddl += " DEFAULT NULL";
			return ddl;
		});
		for (const key of config.primaryKeys)
			columns.push(
				`PRIMARY KEY (${key.columns.map((column) => identifier(column.name)).join(", ")})`,
			);
		for (const index of config.indexes) {
			if (!index.config.unique) continue;
			const names = index.config.columns.map((column) => {
				if (is(column, SQL))
					throw Error(`Fixture requires expression index for ${config.name}`);
				return identifier(column.name);
			});
			columns.push(
				`UNIQUE KEY ${identifier(index.config.name)} (${names.join(", ")})`,
			);
		}
		return `CREATE TABLE ${identifier(config.name)} (${columns.join(",\n")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
	});
}

export async function seedDatabase(
	connection: Connection,
	staffPassword: string,
) {
	for (const statement of fixtureStatements())
		await connection.query(statement);
	// Rank metadata belongs to the emulator and is queried as raw SQL by authorization.
	await connection.query(
		"CREATE TABLE permission_ranks (id INT PRIMARY KEY, rank_name VARCHAR(255) NOT NULL) ENGINE=InnoDB",
	);
	await connection.query(
		"INSERT INTO permission_ranks (id, rank_name) VALUES (1, 'Member'), (7, 'Editor'), (9, 'Owner')",
	);
	for (const migration of [
		"0026_article_editor_recovery.sql",
		"0031_operations_outbox.sql",
	]) {
		const contents = await readFile(
			new URL(`../../drizzle/migrations/${migration}`, import.meta.url),
			"utf8",
		);
		for (const statement of splitSqlStatements(contents))
			await connection.query(statement);
	}
	const password = await bcrypt({
		password: staffPassword,
		salt: randomBytes(16),
		costFactor: 12,
		outputType: "encoded",
	});
	const ownerPassword = await bcrypt({
		password: randomBytes(32).toString("hex"),
		salt: randomBytes(16),
		costFactor: 12,
		outputType: "encoded",
	});
	await connection.query(
		"INSERT INTO users (id, username, password, rank, account_created, ip_register, ip_current, mail, mail_verified) VALUES (?, ?, ?, 7, ?, '127.0.0.1', '127.0.0.1', 'editor@example.invalid', '1'), (9, 'FixtureOwner', ?, 9, ?, '127.0.0.1', '127.0.0.1', 'owner@example.invalid', '1')",
		[
			STAFF_ID,
			STAFF_USERNAME,
			password,
			Math.floor(Date.now() / 1000),
			ownerPassword,
			Math.floor(Date.now() / 1000),
		],
	);
	await connection.query(
		"INSERT INTO acl_roles (id, slug, title) VALUES (1, 'news_editor', 'News editor')",
	);
	await connection.query(
		"INSERT INTO acl_model_roles (model_type, model_id, role_id) VALUES ('User', ?, 1)",
		[STAFF_ID],
	);
	for (const [index, slug] of [
		"admin.dashboard",
		"admin.news.view",
		"admin.news.edit",
	].entries()) {
		await connection.query(
			"INSERT INTO acl_permissions (id, slug, title) VALUES (?, ?, ?)",
			[index + 1, slug, slug],
		);
		await connection.query(
			"INSERT INTO acl_model_permissions (model_type, model_id, permission_id) VALUES ('Role', 1, ?)",
			[index + 1],
		);
	}
	for (const [key, value] of Object.entries({
		hotel_name: "News browser fixture",
		captcha_provider: "none",
		require_email_verification: "1",
		force_staff_2fa: "0",
		maintenance_enabled: "0",
		abuse_guard_enabled: "0",
		radio_enabled: "0",
	}))
		await connection.query(
			"INSERT INTO website_settings (`key`, value) VALUES (?, ?)",
			[key, value],
		);
	await connection.query(
		"INSERT INTO website_languages (country_code, language) VALUES ('en', 'English')",
	);
}
