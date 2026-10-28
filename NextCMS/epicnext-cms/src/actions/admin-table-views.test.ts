// @ts-nocheck
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	allowed: true,
	queries: [] as { sql: string; params: unknown[] }[],
	rows: [] as unknown[],
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({
	getApiAdminContext: async () => ({
		session: { user: { id: 42, rank: 1 } },
		permissions: {},
	}),
	canAccess: () => state.allowed,
}));
vi.mock("@/lib/admin/authorization-events", () => ({
	logAuthorizationEvent: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/foundation/security", () => ({
	extractClientIpAsync: async () => "127.0.0.1",
}));
vi.mock("@/lib/db", async () => {
	const { createDbHelpers } = await import("@/test/db-helpers");
	const execute = async (sql: SQL) => {
		const query = new MySqlDialect().sqlToQuery(sql);
		state.queries.push(query);
		return [state.rows];
	};
	return {
		...createDbHelpers(execute),
		db: {
			execute,
			transaction: async (fn: (tx: { execute: typeof execute }) => unknown) =>
				fn({ execute }),
		},
	};
});

import {
	deleteTableView,
	listTableViews,
	saveTableView,
} from "./admin-table-views";

describe("saved table views access and ownership", () => {
	beforeEach(() => {
		state.allowed = true;
		state.rows = [];
		state.queries = [];
	});
	it("denies ordinary signed-in users without staff permissions before SQL", async () => {
		state.allowed = false;
		expect((await listTableViews({ path: "/admin/users" })).ok).toBe(false);
		expect(
			(
				await saveTableView({
					path: "/admin/users",
					name: "Mine",
					state: { params: {}, hidden: [] },
				})
			).ok,
		).toBe(false);
		expect(
			(await deleteTableView({ path: "/admin/users", name: "Mine" })).ok,
		).toBe(false);
		expect(state.queries).toHaveLength(0);
	});
	it("scopes reads and deletes to the session owner, table, and name", async () => {
		await listTableViews({ path: "/admin/users" });
		expect(state.queries[0].params).toEqual([42, "/admin/users"]);
		expect(state.queries[0].sql).toContain("WHERE user_id = ? AND path = ?");
		await deleteTableView({ path: "/admin/users", name: "Mine" });
		expect(state.queries[1].params).toEqual([42, "/admin/users", "Mine"]);
		expect(state.queries[1].sql).toContain(
			"WHERE user_id = ? AND path = ? AND name = ?",
		);
	});
	it("serializes changes on the owner row and stores only validated state", async () => {
		const view = {
			path: "/admin/users",
			name: "Mine",
			state: { params: { search: "Alice" }, hidden: ["mail"] },
		};
		expect((await saveTableView(view)).ok).toBe(true);
		expect(state.queries[0]).toMatchObject({
			sql: "SELECT id FROM users WHERE id = ? FOR UPDATE",
			params: [42],
		});
		expect(state.queries[2].params).toEqual([
			42,
			"/admin/users",
			"Mine",
			JSON.stringify(view.state),
		]);
	});
	it("rejects invalid stored states without returning them as usable views", async () => {
		state.rows = [
			{ name: "Broken", state: '{"params":{"token":"secret"},"hidden":[]}' },
		];
		expect(await listTableViews({ path: "/admin/users" })).toMatchObject({
			ok: true,
			data: { views: [] },
		});
	});
});
