// @ts-nocheck
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requirePermission } from "@/lib/admin/guard";
import { siteSettings } from "@/lib/services/site-settings";
import { fakeForm } from "@/test/fake-form";
import { saveVpn } from "./admin-vpn";

const { mockValues, mockOnDuplicateKeyUpdate } = vi.hoisted(() => {
	const mockOnDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
	const mockValues = vi.fn(() => ({
		onDuplicateKeyUpdate: mockOnDuplicateKeyUpdate,
	}));
	return { mockValues, mockOnDuplicateKeyUpdate };
});

vi.mock("@/lib/admin/guard", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/permissions", () => ({
	PERMS: { SETTINGS_EDIT: "settings.edit" },
}));
vi.mock("@/lib/db", () => ({
	db: {
		insert: vi.fn(() => ({ values: mockValues })),
	},
	WebsiteSetting: { key: "key", value: "value" },
}));
vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { reload: vi.fn() },
}));
vi.mock("@/lib/services/staff-activity", () => ({ logStaffActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const staff = { id: 1, rank: 7, username: "admin" };
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(requirePermission).mockResolvedValue(staff as never);
	mockValues.mockReturnValue({
		onDuplicateKeyUpdate: mockOnDuplicateKeyUpdate,
	});
	mockOnDuplicateKeyUpdate.mockResolvedValue(undefined);
});

describe("saveVpn", () => {
	it("saves VPN settings and redirects", async () => {
		await saveVpn(
			fakeForm({
				vpn_block_enabled: "1",
				vpn_provider: "proxycheck",
				vpn_api_key: "abc123",
			}) as FormData,
		);
		expect(mockValues).toHaveBeenCalledTimes(4);
		expect(mockOnDuplicateKeyUpdate).toHaveBeenCalledTimes(4);
		expect(siteSettings.reload).toHaveBeenCalled();
		expect(redirect).toHaveBeenCalledWith("/admin/vpn?saved=1");
	});
});
