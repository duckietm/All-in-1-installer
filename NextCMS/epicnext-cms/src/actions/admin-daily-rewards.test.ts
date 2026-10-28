// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requirePermission: vi.fn(),
	insertValues: vi.fn(),
	updateSet: vi.fn(),
	updateWhere: vi.fn(async () => [{ affectedRows: 1 }]),
	deleteWhere: vi.fn(async () => [{ affectedRows: 1 }]),
	revalidatePath: vi.fn(),
	logServerError: vi.fn(),
	siteSettingsUpdate: vi.fn(async () => undefined),
}));

vi.mock("@/lib/admin/guard", () => ({
	requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/permissions", () => ({
	PERMS: { DAILY_REWARDS_EDIT: "admin.dailyrewards.edit" },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	return {
		...schema,
		db: {
			insert: vi.fn(() => ({ values: mocks.insertValues })),
			update: vi.fn(() => ({ set: mocks.updateSet })),
			delete: vi.fn(() => ({ where: mocks.deleteWhere })),
		},
	};
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/server-log", () => ({ logServerError: mocks.logServerError }));
vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { update: mocks.siteSettingsUpdate },
}));

import { PERMS } from "@/lib/permissions";
import {
	deleteDailyReward,
	setDailyRewardEnabled,
	upsertDailyReward,
} from "./admin-daily-rewards";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requirePermission.mockResolvedValue({ id: 1, rank: 7, username: "a" });
	mocks.insertValues.mockReturnValue({
		onDuplicateKeyUpdate: vi.fn(async () => [{}]),
	});
	mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
	mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
	mocks.deleteWhere.mockResolvedValue([{ affectedRows: 1 }]);
	mocks.siteSettingsUpdate.mockResolvedValue(undefined);
});

describe("upsertDailyReward", () => {
	it("inserts a new reward and revalidates both surfaces", async () => {
		const result = await upsertDailyReward({
			day: "3",
			currency: "Duckets",
			amount: "500",
		});

		expect(mocks.requirePermission).toHaveBeenCalledWith(
			PERMS.DAILY_REWARDS_EDIT,
		);
		expect(mocks.insertValues).toHaveBeenCalledWith({
			day: 3,
			currency: "duckets",
			amount: 500,
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/daily-rewards");
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/me");
		expect(result).toEqual({ ok: true, data: {} });
	});

	it("updates an existing reward by id", async () => {
		const result = await upsertDailyReward({
			id: "12",
			day: "1",
			currency: "credits",
			amount: "10",
		});

		expect(mocks.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				day: 1,
				currency: "credits",
				amount: 10,
				updatedAt: expect.any(Date),
			}),
		);
		expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ ok: true, data: {} });
	});

	it("rejects a day outside 1..365", async () => {
		expect(
			await upsertDailyReward({ day: "0", currency: "credits", amount: "5" }),
		).toEqual({
			ok: false,
			error: "Reward day must be between 1 and 365",
		});
		expect(
			await upsertDailyReward({ day: "366", currency: "credits", amount: "5" }),
		).toEqual({
			ok: false,
			error: "Reward day must be between 1 and 365",
		});
		expect(mocks.insertValues).not.toHaveBeenCalled();
	});

	it("rejects a non-positive amount", async () => {
		expect(
			await upsertDailyReward({ day: "1", currency: "credits", amount: "0" }),
		).toEqual({ ok: false, error: "Reward amount must be positive" });
	});

	it("rejects an unknown currency", async () => {
		expect(
			await upsertDailyReward({ day: "1", currency: "gold", amount: "5" }),
		).toEqual({
			ok: false,
			error: "Reward currency is not one of the emulator wallets",
		});
	});

	it("rejects a payload with no currency", async () => {
		expect(await upsertDailyReward({ day: "1", amount: "5" } as never)).toEqual(
			{
				ok: false,
				error: "Reward currency is not one of the emulator wallets",
			},
		);
	});

	it("returns a friendly error when the write fails", async () => {
		mocks.insertValues.mockReturnValueOnce({
			onDuplicateKeyUpdate: vi.fn(async () => {
				throw new Error("db down");
			}),
		});

		const result = await upsertDailyReward({
			day: "2",
			currency: "diamonds",
			amount: "1",
		});

		expect(mocks.logServerError).toHaveBeenCalledWith(
			"admin.daily_reward_upsert_failed",
			expect.any(Error),
		);
		expect(result).toEqual({
			ok: false,
			error: "Reward day could not be saved",
		});
	});

	it("returns a friendly error when the update fails", async () => {
		mocks.updateWhere.mockRejectedValueOnce(new Error("db down"));

		const result = await upsertDailyReward({
			id: "3",
			day: "2",
			currency: "points",
			amount: "1",
		});

		expect(result).toEqual({
			ok: false,
			error: "Reward day could not be saved",
		});
	});

	it("propagates a permission denial", async () => {
		mocks.requirePermission.mockRejectedValueOnce(new Error("redirect:/admin"));

		await expect(
			upsertDailyReward({ day: "1", currency: "credits", amount: "1" }),
		).rejects.toThrow("redirect:/admin");
		expect(mocks.insertValues).not.toHaveBeenCalled();
	});
});

describe("deleteDailyReward", () => {
	it("deletes a reward by id", async () => {
		const result = await deleteDailyReward({ id: "5" });

		expect(mocks.requirePermission).toHaveBeenCalledWith(
			PERMS.DAILY_REWARDS_EDIT,
		);
		expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/daily-rewards");
		expect(result).toEqual({ ok: true, data: {} });
	});

	it("rejects a missing or invalid id", async () => {
		expect(await deleteDailyReward({ id: "" })).toEqual({
			ok: false,
			error: "Missing reward id",
		});
		expect(await deleteDailyReward({ id: "abc" })).toEqual({
			ok: false,
			error: "Missing reward id",
		});
		expect(mocks.deleteWhere).not.toHaveBeenCalled();
	});

	it("rejects a payload with no id field", async () => {
		expect(await deleteDailyReward({} as never)).toEqual({
			ok: false,
			error: "Missing reward id",
		});
		expect(mocks.deleteWhere).not.toHaveBeenCalled();
	});

	it("returns a friendly error when the delete fails", async () => {
		mocks.deleteWhere.mockRejectedValueOnce(new Error("db down"));

		const result = await deleteDailyReward({ id: "8" });

		expect(mocks.logServerError).toHaveBeenCalledWith(
			"admin.daily_reward_delete_failed",
			expect.any(Error),
			{ rewardId: "8" },
		);
		expect(result).toEqual({
			ok: false,
			error: "Reward day could not be deleted",
		});
	});
});

describe("setDailyRewardEnabled", () => {
	it("enables the reward feature", async () => {
		const result = await setDailyRewardEnabled({ enabled: true });

		expect(mocks.siteSettingsUpdate).toHaveBeenCalledWith(
			"daily_reward_enabled",
			"1",
		);
		expect(result).toEqual({ ok: true, data: {} });
	});

	it("disables the reward feature", async () => {
		await setDailyRewardEnabled({ enabled: false });

		expect(mocks.siteSettingsUpdate).toHaveBeenCalledWith(
			"daily_reward_enabled",
			"0",
		);
	});

	it("returns a friendly error when the setting write fails", async () => {
		mocks.siteSettingsUpdate.mockRejectedValueOnce(new Error("db down"));

		const result = await setDailyRewardEnabled({ enabled: true });

		expect(mocks.logServerError).toHaveBeenCalledWith(
			"admin.daily_reward_toggle_failed",
			expect.any(Error),
		);
		expect(result).toEqual({
			ok: false,
			error: "Reward setting could not be saved",
		});
	});
});
