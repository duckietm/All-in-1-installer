import { describe, expect, it } from "vitest";
import { authorizationActivity } from "@/lib/admin/authorization-event";

describe("authorizationActivity", () => {
	it("creates a safe rank-aware denial record", () => {
		const record = authorizationActivity({
			kind: "permission.denied",
			userId: 42,
			username: "admin",
			rank: 11,
			permission: "admin.logs.view",
			source: "/admin/logs",
			reason: "missing permission",
		});
		expect(record.action).toBe("permission.denied");
		expect(record.description).toContain("rank=11");
		expect(record.description).toContain("permission=admin.logs.view");
	});

	it("redacts secrets and technical details", () => {
		const record = authorizationActivity({
			kind: "permission.load_error",
			userId: 42,
			rank: 11,
			source: "permissions",
			reason: "token=abc password=hunter2 SELECT * FROM users",
		});
		expect(record.description).not.toMatch(/abc|hunter2|SELECT/i);
	});
});
