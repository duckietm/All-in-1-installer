// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequirePermission = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());
const mockLogServerError = vi.hoisted(() => vi.fn());
const mockSiteSettingUpdate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin/guard", () => ({
	requirePermission: mockRequirePermission,
}));

vi.mock("@/lib/permissions", () => ({
	PERMS: { REFERRALS_EDIT: "admin.referrals.edit" },
}));

vi.mock("next/cache", () => ({
	revalidatePath: mockRevalidatePath,
	unstable_cache: (fn: any) => fn,
}));

vi.mock("@/lib/server-log", () => ({
	logServerError: mockLogServerError,
}));

vi.mock("@/lib/safe-action-shared", () => ({
	actionOk: (data?: unknown) => ({ ok: true, data: data ?? {} }),
	actionError: (message: string) => ({ ok: false, error: message }),
}));

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { update: mockSiteSettingUpdate },
}));

import { updateReferralSettings } from "./admin-referrals";

beforeEach(() => {
	vi.clearAllMocks();
	mockRequirePermission.mockResolvedValue({
		id: 1,
		rank: 7,
		username: "admin",
	});
	mockSiteSettingUpdate.mockResolvedValue(undefined);
});

describe("updateReferralSettings", () => {
	it("saves valid settings and returns ok", async () => {
		const result = await updateReferralSettings({
			referralsNeeded: "5",
			rewardAmount: "100",
			rewardCurrency: "duckets",
			blockSameIp: "1",
		});

		expect(mockRequirePermission).toHaveBeenCalledWith("admin.referrals.edit");
		expect(mockSiteSettingUpdate).toHaveBeenNthCalledWith(
			1,
			"referrals_needed",
			"5",
		);
		expect(mockSiteSettingUpdate).toHaveBeenNthCalledWith(
			2,
			"referral_reward_amount",
			"100",
		);
		expect(mockSiteSettingUpdate).toHaveBeenNthCalledWith(
			3,
			"referral_reward_currency_type",
			"duckets",
		);
		expect(mockSiteSettingUpdate).toHaveBeenNthCalledWith(
			4,
			"referrals_block_same_ip",
			"1",
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/referrals");
		expect(result).toEqual({ ok: true, data: {} });
	});

	it("normalizes currency case/spacing and stores blockSameIp 0", async () => {
		const result = await updateReferralSettings({
			referralsNeeded: "10",
			rewardAmount: "50",
			rewardCurrency: "  DUCKETS  ",
			blockSameIp: "0",
		});

		expect(mockSiteSettingUpdate).toHaveBeenCalledWith(
			"referral_reward_currency_type",
			"duckets",
		);
		expect(mockSiteSettingUpdate).toHaveBeenCalledWith(
			"referrals_block_same_ip",
			"0",
		);
		expect(result).toEqual({ ok: true, data: {} });
	});

	it("rejects when referrals needed is below 1", async () => {
		const result = await updateReferralSettings({
			referralsNeeded: "0",
			rewardAmount: "100",
			rewardCurrency: "credits",
			blockSameIp: "0",
		});
		expect(result).toEqual({
			ok: false,
			error: "Referrals needed must be at least 1",
		});
		expect(mockSiteSettingUpdate).not.toHaveBeenCalled();
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});

	it("rejects a non-numeric referrals needed", async () => {
		const result = await updateReferralSettings({
			referralsNeeded: "abc",
			rewardAmount: "100",
			rewardCurrency: "credits",
			blockSameIp: "0",
		});
		expect(result.ok).toBe(false);
	});

	it("rejects a non-positive reward amount", async () => {
		const result = await updateReferralSettings({
			referralsNeeded: "3",
			rewardAmount: "-5",
			rewardCurrency: "credits",
			blockSameIp: "0",
		});
		expect(result).toEqual({
			ok: false,
			error: "Reward amount must be positive",
		});
	});

	it("rejects an unsupported reward currency", async () => {
		const result = await updateReferralSettings({
			referralsNeeded: "3",
			rewardAmount: "10",
			rewardCurrency: "gemstones",
			blockSameIp: "0",
		});
		expect(result).toEqual({
			ok: false,
			error: "Reward currency is not one of the emulator wallets",
		});
	});

	it("rejects when the caller lacks REFERRALS_EDIT", async () => {
		mockRequirePermission.mockRejectedValueOnce(new Error("denied"));
		await expect(
			updateReferralSettings({
				referralsNeeded: "3",
				rewardAmount: "10",
				rewardCurrency: "credits",
				blockSameIp: "0",
			}),
		).rejects.toThrow("denied");
	});

	it("returns an error message when saving fails", async () => {
		mockSiteSettingUpdate.mockRejectedValueOnce(new Error("db gone"));
		const result = await updateReferralSettings({
			referralsNeeded: "3",
			rewardAmount: "10",
			rewardCurrency: "points",
			blockSameIp: "1",
		});
		expect(mockLogServerError).toHaveBeenCalledWith(
			"admin.referral_settings_update_failed",
			expect.any(Error),
		);
		expect(result).toEqual({
			ok: false,
			error: "Referral settings could not be saved",
		});
		expect(mockRevalidatePath).not.toHaveBeenCalled();
	});
});
