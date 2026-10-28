// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	total: 60,
	fail: false,
	queries: [] as { sql: string; params: unknown[] }[],
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { drizzle } = await import("drizzle-orm/mysql-proxy");
	return {
		...schema,
		db: drizzle(async (sql, params) => {
			if (state.fail) throw Error("unavailable");
			state.queries.push({ sql, params });
			return { rows: sql.includes("count(*)") ? [[state.total]] : [] };
		}),
	};
});

import { loadPublicEvents } from "./public-events";

describe("public events", () => {
	beforeEach(() => {
		state.queries = [];
		state.fail = false;
		state.total = 60;
	});
	it("limits public upcoming events before pagination", async () => {
		expect(
			await loadPublicEvents({
				status: "upcoming",
				page: 2,
				now: new Date("2026-09-11"),
			}),
		).toMatchObject({ page: 2, lastPage: 3 });
		expect(state.queries[1].params.slice(-2)).toEqual([24, 24]);
		expect(state.queries[0].params.slice(0, 3)).toEqual([
			"published",
			"completed",
			"published",
		]);
		expect(state.queries[0].sql).toContain("`starts_at` > ?");
	});
	it("filters ongoing events using both start and end", async () => {
		await loadPublicEvents({ status: "ongoing" });
		expect(state.queries[0].sql).toContain("`starts_at` <= ?");
		expect(state.queries[0].sql).toContain("`ends_at` > ?");
	});
	it("filters registrations by the authenticated user and weekly bounds", async () => {
		await loadPublicEvents({ mine: true, userId: 77, week: "2026-09-07" });
		expect(state.queries[0].sql).toContain("exists (select");
		expect(state.queries[0].params).toContain(77);
		expect(state.queries[0].sql).toContain("`starts_at` >= ?");
		expect(state.queries[0].sql).toContain("`starts_at` < ?");
	});
	it("returns no personal events for signed out visitors", async () => {
		await loadPublicEvents({ mine: true });
		expect(state.queries[0].sql).toContain("1 = 0");
	});
	it("does not mask service failures as an empty event list", async () => {
		state.fail = true;
		await expect(loadPublicEvents()).rejects.toThrow();
	});
});
