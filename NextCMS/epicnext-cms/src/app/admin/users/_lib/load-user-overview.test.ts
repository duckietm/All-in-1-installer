import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMS } from "@/lib/permission-slugs";
import type { PermissionSet } from "@/lib/permissions";

const state = vi.hoisted(() => ({
	allowed: new Set<string>(),
	execute: vi.fn(),
}));
vi.mock("@/lib/db", async () => ({
	...(await import("@/test/db-helpers")).createDbHelpers(state.execute),
	db: { execute: state.execute },
}));
vi.mock("@/lib/permissions", async () => ({
	...(await import("@/lib/permission-slugs")),
	canAccess: (_: unknown, permission: string) => state.allowed.has(permission),
}));

import { loadUserOverview } from "./load-user-overview";

const permissions = {} as PermissionSet;
const dialect = new MySqlDialect();
beforeEach(() => {
	state.allowed.clear();
	state.execute
		.mockReset()
		.mockResolvedValue([[{ id: 12, title: "Existing record" }], []]);
});
describe("user operational overview", () => {
	it("does not query or expose any restricted source", async () => {
		expect(await loadUserOverview(42, permissions, 4)).toEqual([]);
		expect(state.execute).not.toHaveBeenCalled();
	});
	it.each([
		[PERMS.BANS_VIEW, ["sanctions"]],
		[PERMS.TICKETS_VIEW, ["tickets", "help"]],
		[PERMS.MODERATION_VIEW, ["mute", "reports"]],
		[PERMS.SHOP_VIEW, ["transactions"]],
		[PERMS.LOGS_VIEW, ["purchases", "activity"]],
	])("queries only sources allowed by %s", async (permission, keys) => {
		state.allowed.add(permission);
		const result = await loadUserOverview(42, permissions, 4);
		expect(result.map((section) => section.key)).toEqual(keys);
		expect(state.execute).toHaveBeenCalledTimes(keys.length);
		for (const [query] of state.execute.mock.calls) {
			const compiled = dialect.sqlToQuery(query);
			expect(compiled.sql).toMatch(/LIMIT 5$/);
			expect(compiled.params).toContain(42);
		}
	});
	it("keeps accessible sources available when another query fails", async () => {
		state.allowed.add(PERMS.TICKETS_VIEW);
		state.execute.mockRejectedValueOnce(new Error("database unavailable"));
		const result = await loadUserOverview(42, permissions, 4);
		expect(result[0]).toMatchObject({
			key: "tickets",
			state: "error",
			rows: [],
		});
		expect(result[1]).toMatchObject({
			key: "help",
			state: "ready",
			rows: [{ href: "/admin/help-tickets/12" }],
		});
	});
	it("distinguishes an empty source from a failed source", async () => {
		state.allowed.add(PERMS.SHOP_VIEW);
		state.execute.mockResolvedValueOnce([[], []]);
		expect(await loadUserOverview(42, permissions, 4)).toEqual([
			{
				key: "transactions",
				state: "ready",
				rows: [],
				href: "/admin/transactions",
			},
		]);
	});
});
it("selects and preserves recorded purchase quantities and currency costs", async () => {
	state.allowed.add(PERMS.LOGS_VIEW);
	const purchase = {
		id: 5,
		title: "Chair",
		amount: 2,
		credits: 10,
		points: 3,
		pointsType: 5,
	};
	state.execute.mockResolvedValueOnce([[purchase], []]);
	const result = await loadUserOverview(42, permissions, 4);
	const query = dialect.sqlToQuery(state.execute.mock.calls[0][0]).sql;
	expect(query).toContain(
		"amount, cost_credits AS credits, cost_points AS points, points_type AS pointsType",
	);
	expect(
		result.find((section) => section.key === "purchases")?.rows[0],
	).toMatchObject(purchase);
});
