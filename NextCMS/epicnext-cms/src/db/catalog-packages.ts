import {
	int,
	longtext,
	mysqlTable,
	timestamp,
	varchar,
} from "drizzle-orm/mysql-core";
export const CatalogPackages = mysqlTable("website_catalog_packages", {
	id: varchar("id", { length: 36 }).primaryKey(),
	name: varchar("name", { length: 128 }).notNull(),
	version: int("version", { unsigned: true }).notNull(),
	status: varchar("status", { length: 16 }).notNull(),
	mode: varchar("mode", { length: 16 }).notNull(),
	payload: longtext("payload").notNull(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
