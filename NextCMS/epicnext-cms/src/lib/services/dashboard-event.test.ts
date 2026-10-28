// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	rows: [] as unknown[],
	fail: false,
	query: "",
	params: [] as unknown[],
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { drizzle } = await import("drizzle-orm/mysql-proxy");
	return {
		...schema,
		db: drizzle(async (query, params) => {
			state.query = query;
			state.params = params;
			if (state.fail) throw new Error("offline");
			return { rows: state.rows };
		}),
	};
});

import { loadDashboardEvent } from "./dashboard-event";

describe("dashboard event loading", () => {
	beforeEach(() => {
		state.rows = [];
		state.fail = false;
	});
	it("limits to one published ongoing or future event in date order", async () => {
		await loadDashboardEvent(new Date("2026-09-09T12:00:00Z"));
		expect(state.query).toContain("`website_events`.`status` = ?");
		expect(state.query).toContain(
			"(`website_events`.`starts_at` > ? or `website_events`.`ends_at` > ?)",
		);
		expect(state.query).toContain(
			"order by `website_events`.`starts_at` asc, `website_events`.`id` asc limit ?",
		);
		expect(state.params).toEqual([
			"published",
			"2026-09-09 12:00:00.000",
			"2026-09-09 12:00:00.000",
			1,
		]);
	});
	it("distinguishes an empty calendar from a failed query", async () => {
		expect(await loadDashboardEvent()).toEqual({
			event: null,
			unavailable: false,
		});
		state.fail = true;
		expect(await loadDashboardEvent()).toEqual({
			event: null,
			unavailable: true,
		});
	});
	it("returns the next event with the phase derived from its real dates", async () => {
		state.rows = [
			[3, "Quiz", "published", "2026-09-09 13:00:00.000", null, "Games"],
		];
		expect(
			await loadDashboardEvent(new Date("2026-09-09T12:00:00Z")),
		).toMatchObject({
			unavailable: false,
			event: { id: 3, title: "Quiz", phase: "upcoming" },
		});
	});
});
