import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	options: {} as Record<string, unknown>,
	rows: [
		{
			id: 1,
			userId: 2,
			username: '=HYPERLINK("bad")',
			action: "update",
			target: "user",
			targetId: 3,
			createdAt: "2026-09-09",
			diff: '{"password":{"from":"oldsecret","to":"newsecret"}}',
			before: null,
			after: null,
		},
	],
}));
vi.mock("@/lib/api-handler", () => ({
	withAdmin: (options: Record<string, unknown>, handler: unknown) => {
		state.options = options;
		return handler;
	},
}));
vi.mock("@/lib/permissions", () => ({ PERMS: { LOGS_VIEW: "logs.view" } }));
vi.mock("@/lib/services/audit", () => ({
	getAuditLogs: vi.fn(async () => ({ rows: state.rows })),
}));

import { getAuditLogs } from "@/lib/services/audit";
import { GET } from "./route";

describe("audit export", () => {
	beforeEach(() => {
		vi.mocked(getAuditLogs).mockClear();
	});
	it("requires the audit viewing permission and passes the same filters and page", async () => {
		expect(state.options).toMatchObject({ permission: "logs.view" });
		const response = await GET(
			new Request(
				"https://example.test/api/admin/logs/audit/export?actor=Alice&action=update&from=2026-09-09&to=2026-09-10&search=user&page=2&perPage=10",
			) as never,
			{} as never,
		);
		expect(getAuditLogs).toHaveBeenCalledWith({
			actor: "Alice",
			action: "update",
			from: "2026-09-09",
			to: "2026-09-10",
			search: "user",
			page: 2,
			perPage: 10,
		});
		expect(response.headers.get("Cache-Control")).toBe("no-store");
	});
	it("supports JSON export format", async () => {
		const response = await GET(
			new Request(
				"https://example.test/api/admin/logs/audit/export?format=json",
			) as never,
			{} as never,
		);
		expect(response.headers.get("Content-Type")).toContain("application/json");
		const json = await response.json();
		expect(Array.isArray(json)).toBe(true);
		expect(json[0].id).toBe(1);
		expect(json[0].username).toBe('=HYPERLINK("bad")');
	});
	it("escapes CSV formula cells and redacts historical secrets", async () => {
		const response = await GET(
			new Request("https://example.test/api/admin/logs/audit/export") as never,
			{} as never,
		);
		const csv = await response.text();
		expect(csv).toContain("'=HYPERLINK");
		expect(csv).not.toContain("oldsecret");
		expect(csv).not.toContain("newsecret");
		expect(csv).toContain("[Redacted]");
	});
});
