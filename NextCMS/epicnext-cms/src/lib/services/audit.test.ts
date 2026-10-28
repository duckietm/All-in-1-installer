// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const insertValues = vi.hoisted(() => vi.fn());
const selectRows = vi.hoisted(() => vi.fn());
const selectCount = vi.hoisted(() => vi.fn());
const selectUsers = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
	db: {
		insert: vi.fn(() => ({ values: insertValues })),
		select: vi.fn((fields?: { value?: unknown; id?: unknown }) => {
			// count() query passes { value: count() }; user lookup passes { id, username }
			if (fields && "value" in fields && !("id" in fields)) {
				return {
					from: () => ({
						where: () => selectCount(),
					}),
				};
			}
			if (fields && "id" in fields && "username" in fields) {
				return {
					from: () => ({
						where: () => selectUsers(),
					}),
				};
			}
			// default: audit log rows
			return {
				from: () => ({
					where: () => ({
						orderBy: () => ({
							limit: () => ({
								offset: () => selectRows(),
							}),
						}),
					}),
				}),
			};
		}),
	},
	AdminAuditLog: {
		id: "id",
		userId: "userId",
		action: "action",
		target: "target",
	},
	User: { id: "id", username: "username" },
}));

vi.mock("@/env", () => ({ env: {} }));

import {
	createStore,
	runWithStore,
	setContextUserId,
} from "@/lib/foundation/request-context";
import type { IpAddress, UserId } from "@/lib/foundation/types";
import { getAuditLogs, logAudit } from "./audit";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("logAudit", () => {
	it("stores the same trusted operation ID across asynchronous audit writes", async () => {
		const store = createStore("test" as IpAddress);
		await runWithStore(store, async () => {
			setContextUserId(42 as UserId);
			await Promise.resolve();
			await logAudit({
				userId: 42,
				action: "update",
				target: "user",
				after: { name: "Alice" },
			});
		});
		expect(JSON.parse(insertValues.mock.calls[0][0].details)).toEqual({
			operationId: store.requestId,
			userId: 42,
		});
		await logAudit({ userId: 42, action: "outside", target: "user" });
		expect(JSON.parse(insertValues.mock.calls[1][0].details)).toEqual({});
	});
	it("creates an audit entry", async () => {
		insertValues.mockResolvedValue({ id: 1 });
		await logAudit({
			userId: 1,
			action: "test_action",
			target: "user",
			targetId: 42,
		});
		const data = insertValues.mock.calls[0][0];
		expect(data.userId).toBe(1);
		expect(data.action).toBe("test_action");
		expect(data.target).toBe("user");
		expect(data.targetId).toBe(42);
	});

	it("redacts sensitive keys in payload", async () => {
		insertValues.mockResolvedValue({ id: 1 });
		await logAudit({
			userId: 1,
			action: "update",
			target: "user",
			targetId: 1,
			before: { username: "foo", password: "secret123" },
			after: { username: "bar", password: "newsecret" },
		});
		const data = insertValues.mock.calls[0][0];
		expect(JSON.parse(data.before).password).toBe("[Redacted]");
		expect(JSON.parse(data.after).password).toBe("[Redacted]");
		expect(JSON.parse(data.diff).username).toEqual({ from: "foo", to: "bar" });
	});

	it("omits diff when only before or after is missing", async () => {
		insertValues.mockResolvedValue({ id: 1 });
		await logAudit({
			userId: 1,
			action: "delete",
			target: "user",
			before: { username: "foo" },
		});
		const data = insertValues.mock.calls[0][0];
		expect(data.diff).toBeNull();
	});

	it("handles empty payloads", async () => {
		insertValues.mockResolvedValue({ id: 1 });
		await logAudit({ userId: 1, action: "view", target: "page" });
		expect(insertValues).toHaveBeenCalledOnce();
	});

	it("flattens nested objects", async () => {
		insertValues.mockResolvedValue({ id: 1 });
		await logAudit({
			userId: 1,
			action: "update_settings",
			target: "user",
			before: { nested: { key: "val" } },
			after: {},
		});
		const data = insertValues.mock.calls[0][0];
		expect(JSON.parse(data.before)).toEqual({ nested: { key: "val" } });
	});
});

describe("getAuditLogs", () => {
	it("returns paginated logs with usernames", async () => {
		selectRows.mockResolvedValue([
			{
				id: 1,
				userId: 1,
				action: "test",
				target: "user",
				targetId: null,
				before: null,
				after: null,
				diff: null,
				createdAt: "2024-01-01",
			},
			{
				id: 2,
				userId: 2,
				action: "test2",
				target: "room",
				targetId: null,
				before: null,
				after: null,
				diff: null,
				createdAt: "2024-01-02",
			},
		]);
		selectCount.mockResolvedValue([{ value: 2 }]);
		selectUsers.mockResolvedValue([
			{ id: 1, username: "alice" },
			{ id: 2, username: "bob" },
		]);

		const result = await getAuditLogs({ page: 1, perPage: 20 });
		expect(result.rows).toHaveLength(2);
		expect(result.rows[0].username).toBe("alice");
		expect(result.rows[1].username).toBe("bob");
		expect(result.total).toBe(2);
		expect(result.lastPage).toBe(1);
	});

	it("filters by search term", async () => {
		selectRows.mockResolvedValue([]);
		selectCount.mockResolvedValue([{ value: 0 }]);
		await getAuditLogs({ search: "test" });
		expect(selectRows).toHaveBeenCalled();
		expect(selectCount).toHaveBeenCalled();
	});

	it("falls back to User #id for unknown users", async () => {
		selectRows.mockResolvedValue([
			{
				id: 1,
				userId: 99,
				action: "x",
				target: "y",
				targetId: null,
				before: null,
				after: null,
				diff: null,
				createdAt: "2024-01-01",
			},
		]);
		selectCount.mockResolvedValue([{ value: 1 }]);
		selectUsers.mockResolvedValue([]);
		const result = await getAuditLogs();
		expect(result.rows[0].username).toBe("User #99");
	});
});

describe("audit response privacy", () => {
	it("exposes only a validated operation ID, never arbitrary stored details", async () => {
		selectRows.mockResolvedValue([
			{
				id: 1,
				userId: 42,
				diff: null,
				before: null,
				after: null,
				operationDetails: JSON.stringify({
					operationId: "op-123",
					token: "private-token",
					ip: "private-ip",
				}),
			},
			{
				id: 2,
				userId: 42,
				diff: null,
				before: null,
				after: null,
				operationDetails: JSON.stringify({
					operationId: "../../other?token=private",
				}),
			},
		]);
		selectCount.mockResolvedValue([{ value: 2 }]);
		selectUsers.mockResolvedValue([]);
		const result = await getAuditLogs();
		expect(result.rows[0].operationId).toBe("op-123");
		expect(result.rows[1].operationId).toBeNull();
		expect(JSON.stringify(result.rows)).not.toContain("private-token");
		expect(JSON.stringify(result.rows)).not.toContain("private-ip");
		expect(result.rows[0]).not.toHaveProperty("operationDetails");
	});
	it("does not serialize legacy snapshot secrets to the client", async () => {
		selectRows.mockResolvedValue([
			{
				id: 1,
				userId: 1,
				diff: null,
				before: null,
				after: '{"name":"Alice","password":"secret-value"}',
			},
		]);
		selectCount.mockResolvedValue([{ value: 1 }]);
		selectUsers.mockResolvedValue([]);
		const result = await getAuditLogs();
		expect(JSON.stringify(result.rows)).not.toContain("secret-value");
		expect(result.rows[0].before).toBeNull();
		expect(result.rows[0].after).toBeNull();
		expect(result.rows[0].diff).toContain("Alice");
	});
});
