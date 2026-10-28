import { boolean, int, mysqlTable } from "drizzle-orm/mysql-core";

export const WebsiteProfilePrivacy = mysqlTable("website_profile_privacy", {
	userId: int("user_id").primaryKey().notNull(),
	wallet: boolean("wallet").notNull().default(false),
	online: boolean("online").notNull().default(true),
	friends: boolean("friends").notNull().default(true),
	photos: boolean("photos").notNull().default(true),
	registered: boolean("registered").notNull().default(true),
});
