import {
	bigint,
	int,
	longtext,
	mysqlTable,
	primaryKey,
	timestamp,
	varchar,
} from "drizzle-orm/mysql-core";

export const ArticleDrafts = mysqlTable(
	"website_article_drafts",
	{
		userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
		articleKey: varchar("article_key", { length: 32 }).notNull(),
		version: int("version", { unsigned: true }).notNull(),
		payload: longtext("payload").notNull(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.articleKey] })],
);
export const ArticleRevisions = mysqlTable("website_article_revisions", {
	id: bigint("id", { mode: "number", unsigned: true })
		.autoincrement()
		.primaryKey(),
	articleId: bigint("article_id", { mode: "bigint", unsigned: true }).notNull(),
	userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
	payload: longtext("payload").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});
