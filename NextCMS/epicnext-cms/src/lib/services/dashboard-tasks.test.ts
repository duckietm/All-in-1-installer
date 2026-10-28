// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	fail: false,
	queries: [] as { query: string; params: unknown[] }[],
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { drizzle } = await import("drizzle-orm/mysql-proxy");
	return {
		...schema,
		db: drizzle(async (query, params) => {
			state.queries.push({ query, params });
			if (state.fail) throw new Error("offline");
			return { rows: query.includes("count(*)") ? [[0]] : [] };
		}),
	};
});

import { loadDashboardTasks } from "./dashboard-tasks";

describe("personal dashboard tasks", () => {
	beforeEach(() => {
		state.fail = false;
		state.queries = [];
	});
	it("rejects invalid user ids before accessing the database", async () => {
		await expect(loadDashboardTasks(0)).rejects.toThrow("Invalid user");
		expect(state.queries).toHaveLength(0);
	});
	it("scopes every query to the signed-in user and only offers future published registrations", async () => {
		expect(
			await loadDashboardTasks(42, new Date("2026-09-11T12:00:00Z")),
		).toEqual({ support: 0, friendRequests: 0, registeredEvent: false });
		expect(state.queries).toHaveLength(3);
		for (const { params } of state.queries) expect(params).toContain(42);
		const support = state.queries.find(({ query }) =>
			query.includes("website_help_center_tickets"),
		);
		expect(support?.query).toContain(
			"`website_help_center_tickets`.`open` = ?",
		);
		expect(support?.query).toContain(
			"order by `website_help_center_ticket_replies`.`id` desc limit 1) <> ?",
		);
		const event = state.queries.find(({ query }) =>
			query.includes("website_events"),
		);
		expect(event?.params).toEqual([
			42,
			"published",
			"2026-09-11 12:00:00.000",
			1,
		]);
	});
	it("does not report empty tasks when the database is unavailable", async () => {
		state.fail = true;
		expect(await loadDashboardTasks(42)).toEqual({
			support: null,
			friendRequests: null,
			registeredEvent: null,
		});
	});
});
