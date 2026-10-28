// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	queries: [] as { sql: string; params: unknown[] }[],
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { drizzle } = await import("drizzle-orm/mysql-proxy");
	return {
		...schema,
		db: drizzle(async (sql, params) => {
			state.queries.push({ sql, params });
			return { rows: [] };
		}),
	};
});

import { getAuditLogs } from "./audit";

describe("audit query filters", () => {
	beforeEach(() => {
		state.queries = [];
	});
	it("binds actor/action/date/search values in both list and count queries", async () => {
		await getAuditLogs({
			actor: "Alice' OR 1=1 --",
			action: "update",
			search: "user",
			from: "2026-09-09",
			to: "2026-09-09",
			perPage: 10,
			page: 2,
		});
		expect(state.queries).toHaveLength(2);
		for (const query of state.queries) {
			expect(query.sql).not.toContain("Alice");
			expect(query.sql).toContain("`admin_audit_log`.`user_id` in (select");
			expect(query.sql).toContain("`admin_audit_log`.`created_at` >= ?");
			expect(query.sql).toContain("`admin_audit_log`.`details` like ?");
			expect(query.sql).toContain("`admin_audit_log`.`created_at` < ?");
			expect(query.params.slice(0, 7)).toEqual([
				"%user%",
				"%user%",
				"%user%",
				"update",
				"Alice' OR 1=1 --",
				"2026-09-09",
				"2026-09-10",
			]);
		}
		expect(state.queries[0].params.slice(-2)).toEqual([10, 10]);
	});
	it("uses an exact numeric actor ID and caps row count", async () => {
		await getAuditLogs({ actor: "42", perPage: 1000, page: -2 });
		expect(state.queries[0].params).toEqual([42, 100]);
		expect(state.queries[0].sql).not.toContain("in (select");
	});
});
