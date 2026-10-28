// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockValues,
	mockOnDuplicateKeyUpdate,
	mockRequirePermission,
	mockReload,
	mockRevalidatePath,
} = vi.hoisted(() => {
	const mockOnDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
	const mockValues = vi.fn(() => ({
		onDuplicateKeyUpdate: mockOnDuplicateKeyUpdate,
	}));
	return {
		mockValues,
		mockOnDuplicateKeyUpdate,
		mockRequirePermission: vi.fn(),
		mockReload: vi.fn(),
		mockRevalidatePath: vi.fn(),
	};
});

vi.mock("@/lib/permissions", () => ({
	PERMS: {
		ADMIN_DASHBOARD: "admin.dashboard",
		SETTINGS_VIEW: "admin.settings.view",
		SETTINGS_EDIT: "admin.settings.edit",
	},
}));

vi.mock("@/lib/db", () => ({
	db: {
		insert: vi.fn(() => ({ values: mockValues })),
	},
	WebsiteSetting: { key: "key", value: "value" },
}));

vi.mock("@/lib/admin/guard", () => ({
	requirePermission: mockRequirePermission,
}));

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { reload: mockReload },
}));

vi.mock("next/cache", () => ({
	revalidatePath: mockRevalidatePath,
}));

import { saveMaintenance } from "./admin-maintenance";

beforeEach(() => {
	vi.clearAllMocks();
	mockValues.mockReturnValue({
		onDuplicateKeyUpdate: mockOnDuplicateKeyUpdate,
	});
	mockOnDuplicateKeyUpdate.mockResolvedValue(undefined);
});

describe("saveMaintenance", () => {
	it("enables maintenance mode with message and min rank", async () => {
		mockRequirePermission.mockResolvedValue({
			id: 1,
			rank: 7,
			username: "admin",
		});

		const fd = new FormData();
		fd.set("enabled", "on");
		fd.set("message", "We will be back soon!");
		fd.set("min_rank", "3");

		await saveMaintenance(fd);

		expect(mockRequirePermission).toHaveBeenCalled();

		expect(mockValues).toHaveBeenCalledTimes(3);
		expect(mockValues).toHaveBeenCalledWith(
			expect.objectContaining({
				key: "maintenance_enabled",
				value: "1",
			}),
		);
		expect(mockValues).toHaveBeenCalledWith(
			expect.objectContaining({
				key: "maintenance_message",
				value: "We will be back soon!",
			}),
		);
		expect(mockValues).toHaveBeenCalledWith(
			expect.objectContaining({
				key: "min_maintenance_login_rank",
				value: "3",
			}),
		);
		expect(mockOnDuplicateKeyUpdate).toHaveBeenCalledTimes(3);

		expect(mockReload).toHaveBeenCalledOnce();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/maintenance");
	});

	it("disables maintenance mode", async () => {
		mockRequirePermission.mockResolvedValue({
			id: 1,
			rank: 7,
			username: "admin",
		});

		const fd = new FormData();
		fd.set("message", "");
		fd.set("min_rank", "");

		await saveMaintenance(fd);

		expect(mockValues).toHaveBeenCalledWith(
			expect.objectContaining({
				key: "maintenance_enabled",
				value: "0",
			}),
		);
		expect(mockValues).toHaveBeenCalledWith(
			expect.objectContaining({
				key: "min_maintenance_login_rank",
				value: "5",
			}),
		);
	});

	it("defaults min_rank to 5 when input is empty", async () => {
		mockRequirePermission.mockResolvedValue({
			id: 1,
			rank: 7,
			username: "admin",
		});

		const fd = new FormData();
		fd.set("enabled", "on");
		fd.set("message", "");
		fd.set("min_rank", "");

		await saveMaintenance(fd);

		expect(mockValues).toHaveBeenCalledWith(
			expect.objectContaining({
				key: "min_maintenance_login_rank",
				value: "5",
			}),
		);
	});

	it("defaults min_rank to 5 when input is negative", async () => {
		mockRequirePermission.mockResolvedValue({
			id: 1,
			rank: 7,
			username: "admin",
		});

		const fd = new FormData();
		fd.set("enabled", "on");
		fd.set("message", "");
		fd.set("min_rank", "-1");

		await saveMaintenance(fd);

		expect(mockValues).toHaveBeenCalledWith(
			expect.objectContaining({
				key: "min_maintenance_login_rank",
				value: "5",
			}),
		);
	});

	it("calls requirePermission with SETTINGS_EDIT", async () => {
		mockRequirePermission.mockResolvedValue({
			id: 1,
			rank: 7,
			username: "admin",
		});

		const fd = new FormData();
		fd.set("message", "");
		fd.set("min_rank", "");

		await saveMaintenance(fd);

		expect(mockRequirePermission).toHaveBeenCalledWith("admin.settings.edit");
	});
});
