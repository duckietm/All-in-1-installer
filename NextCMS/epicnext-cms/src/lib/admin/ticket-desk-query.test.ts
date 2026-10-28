import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => import("@/db/schema"));

import {
	awaitingStaffCondition,
	latestTicketReplyAt,
	ticketAssignmentCondition,
} from "./ticket-desk-query";

const dialect = new MySqlDialect();
describe("support desk query", () => {
	it("binds the signed-in staff ID and distinguishes unassigned tickets", () => {
		const mine = ticketAssignmentCondition("mine", 123);
		expect(mine && dialect.sqlToQuery(mine).params).toEqual([123]);
		const none = ticketAssignmentCondition("unassigned", 123);
		expect(none && dialect.sqlToQuery(none).sql).toContain("is null");
		expect(ticketAssignmentCondition("123 OR 1=1", 123)).toBeUndefined();
	});
	it("requires an active ticket and resolves equal timestamps by message id", () => {
		expect(awaitingStaffCondition).toBeDefined();
		if (!awaitingStaffCondition) return;
		const query = dialect.sqlToQuery(awaitingStaffCondition);
		expect(query.params).toEqual(["closed", 0]);
		expect(query.sql).toContain("m.is_staff");
		expect(query.sql).toContain("m.created_at DESC, m.id DESC LIMIT 1");
		expect(dialect.sqlToQuery(latestTicketReplyAt).sql).toContain("COALESCE");
	});
});
