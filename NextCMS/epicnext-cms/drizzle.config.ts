import { defineConfig } from "drizzle-kit";

// Schema source of truth for the query builder: src/db/schema.ts
// (regenerated via `pnpm db:schema:generate` from the previous schema + live DB).
//
// This DB is shared with the Arcturus emulator — NEVER run `drizzle-kit migrate`
// or `push` against it. CMS DDL stays in drizzle/migrations/*.sql applied by
// `pnpm db:migrate`. Use `pnpm db:generate` only for draft SQL under drizzle/drafts/.
const dbUrl = process.env.DATABASE_URL ?? "";
const isPostgres =
	dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://");

export default defineConfig({
	dialect: isPostgres ? "postgresql" : "mysql",
	schema: "./src/db/schema.ts",
	out: "./drizzle/drafts",
	dbCredentials: {
		url: dbUrl,
	},
	strict: true,
	verbose: true,
});
