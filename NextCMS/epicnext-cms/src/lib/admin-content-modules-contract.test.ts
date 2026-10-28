// @ts-nocheck
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tables = [
	"website_event_types",
	"website_events",
	"website_event_registrations",
	"website_event_prizes",
	"website_event_winners",
	"website_polls",
	"website_poll_questions",
	"website_poll_votes",
	"website_banners",
	"custom_prefixes",
	"custom_prefix_blacklist",
	"custom_prefix_settings",
];

describe("admin content module port", () => {
	it("owns every required table through schema and migration contracts", () => {
		const schema = readFileSync(resolve("src/db/schema.ts"), "utf8");
		const migration = readFileSync(
			resolve(
				"drizzle/migrations/0013_admin_events_polls_banners_prefixes.sql",
			),
			"utf8",
		);
		for (const table of tables) {
			expect(migration).toContain(`CREATE TABLE IF NOT EXISTS \`${table}\``);
			if (!table.startsWith("custom_prefix"))
				expect(schema).toContain(`"${table}"`);
		}
	});

	it("provides locale-free routes and matching server actions", () => {
		for (const module of ["events", "polls", "banners", "prefixes"]) {
			expect(existsSync(resolve(`src/app/admin/${module}/page.tsx`))).toBe(
				true,
			);
			expect(existsSync(resolve(`src/actions/${module}.ts`))).toBe(true);
		}
	});
});
