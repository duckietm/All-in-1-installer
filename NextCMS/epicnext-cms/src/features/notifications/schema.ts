import {
	boolean,
	int,
	mysqlTable,
	primaryKey,
	timestamp,
	varchar,
} from "drizzle-orm/mysql-core";
export const NotificationRead = mysqlTable(
	"website_notification_reads",
	{
		userId: int("user_id").notNull(),
		eventKey: varchar("event_key", { length: 128 }).notNull(),
		readAt: timestamp("read_at").notNull().defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.eventKey] })],
);
export const NotificationPreference = mysqlTable(
	"website_notification_preferences",
	{
		userId: int("user_id").primaryKey().notNull(),
		support: boolean("support").notNull().default(true),
		friends: boolean("friends").notNull().default(true),
		events: boolean("events").notNull().default(true),
	},
);
