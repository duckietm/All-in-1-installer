// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const insertValues = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
	db: {
		insert: vi.fn(() => ({ values: insertValues })),
	},
	StaffActivities: {},
}));

vi.mock("@/env", () => ({ env: {} }));

vi.mock("next/headers", () => ({
	headers: () =>
		new Promise((resolve) =>
			resolve({
				get: (key: string) =>
					key === "x-forwarded-for" ? "192.168.1.1" : null,
			}),
		),
}));

import { logStaffActivity } from "./staff-activity";

beforeEach(() => {
	vi.clearAllMocks();
	insertValues.mockResolvedValue([{ insertId: 1 }]);
});

describe("logStaffActivity", () => {
	it("creates a staff activity entry with ip", async () => {
		await logStaffActivity({
			staffId: 1,
			action: "test_action",
			description: "Test action performed",
		});
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: BigInt(1),
				action: "test_action",
				description: "Test action performed",
				ipAddress: "192.168.1.1",
			}),
		);
	});

	it("truncates action to 50 chars", async () => {
		const longAction = "a".repeat(100);
		await logStaffActivity({
			staffId: 1,
			action: longAction,
			description: "test",
		});
		const call = insertValues.mock.calls[0][0];
		expect(call.action.length).toBe(50);
		expect(call.action).toBe("a".repeat(50));
	});

	it("includes target type and target id when provided", async () => {
		await logStaffActivity({
			staffId: 1,
			action: "ban",
			description: "Banned user",
			targetType: "user",
			targetId: 42,
		});
		const data = insertValues.mock.calls[0][0];
		expect(data.targetType).toBe("user");
		expect(data.targetId).toBe(BigInt(42));
	});

	it("does not throw on db error", async () => {
		insertValues.mockRejectedValue(new Error("DB down"));
		await expect(
			logStaffActivity({
				staffId: 1,
				action: "test",
				description: "test",
			}),
		).resolves.toBeUndefined();
	});
});
