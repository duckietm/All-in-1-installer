// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	rows: [] as unknown[],
	requirePermission: vi.fn(),
}));

vi.mock("@/lib/admin/guard", () => ({
	requirePermission: state.requirePermission,
}));
vi.mock("@/lib/permissions", () => ({
	PERMS: { SETTINGS_VIEW: "admin.settings.view" },
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	return {
		...schema,
		db: createFakeDb(() => state.rows),
	};
});

import { PERMS } from "@/lib/permissions";
import { exportPermissions } from "./admin-housekeeping";

beforeEach(() => {
	vi.clearAllMocks();
	state.rows = [];
	state.requirePermission.mockResolvedValue({ id: 1, rank: 7, username: "a" });
});

describe("exportPermissions", () => {
	it("returns the housekeeping permissions as pretty JSON", async () => {
		const rows = [
			{
				permission: "admin.users.edit",
				minRank: 7,
				description: "Edit users",
				groupName: "Users",
				dependsOn: null,
			},
		];
		state.rows = rows;

		const result = await exportPermissions();

		expect(state.requirePermission).toHaveBeenCalledWith(PERMS.SETTINGS_VIEW);
		expect(result).toBe(JSON.stringify(rows, null, 2));
	});

	it("returns an empty JSON array when there are no permissions", async () => {
		await expect(exportPermissions()).resolves.toBe("[]");
	});

	it("propagates a permission denial", async () => {
		state.requirePermission.mockRejectedValueOnce(new Error("redirect:/"));

		await expect(exportPermissions()).rejects.toThrow("redirect:/");
	});
});
