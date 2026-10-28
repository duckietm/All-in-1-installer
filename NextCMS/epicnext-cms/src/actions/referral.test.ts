// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	auth: vi.fn(async () => ({ user: { id: "5" } })),
	rateLimit: vi.fn(async () => ({ ok: true })),
	clientIp: vi.fn(async () => "203.0.113.9"),
	revalidatePath: vi.fn(),
	sendCurrency: vi.fn(async () => true),
	update: vi.fn(async () => [{ affectedRows: 1 }]),
	insert: vi.fn(async () => [{ insertId: 1 }]),
	settingsRows: [] as Array<{ key: string; value: string }>,
	referralsRows: [] as Array<{ id: bigint; referralsTotal: bigint }>,
	settingsFail: false,
	referralsFail: false,
}));

vi.mock("next/cache", () => ({ revalidatePath: state.revalidatePath }));
vi.mock("next/navigation", () => ({
	redirect: (path: string) => {
		throw Object.assign(new Error(path), { digest: `NEXT_REDIRECT:${path}` });
	},
}));
vi.mock("@/lib/auth", () => ({ auth: state.auth }));
vi.mock("@/lib/rate-limit", () => ({
	rateLimit: state.rateLimit,
	clientIp: state.clientIp,
}));
vi.mock("@/lib/services/send-currency", () => ({
	sendCurrency: state.sendCurrency,
	currencyDb: { user: {}, usersCurrency: {} },
}));
vi.mock("@/lib/services/rcon", () => ({
	rcon: { send: vi.fn() },
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb(
		(_table: unknown, projection: Record<string, unknown>) => {
			if ("referralsTotal" in projection) {
				if (state.referralsFail) throw new Error("referrals down");
				return state.referralsRows;
			}
			if ("key" in projection) {
				if (state.settingsFail) throw new Error("settings down");
				return state.settingsRows;
			}
			return [];
		},
	);
	return {
		...schema,
		db: {
			...fake,
			update: (table: unknown) => ({
				set: (values: unknown) => ({
					where: (where: unknown) => state.update(table, values, where),
				}),
			}),
			insert: (table: unknown) => ({
				values: (values: unknown) => state.insert(table, values),
			}),
		},
	};
});

import { ClaimedReferralLogs, UserReferrals } from "@/lib/db";
import { claimReferral } from "./referral";

const BIG_ID = 7n;
const BIG_TEN = 10n;

describe("claimReferral", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.auth.mockResolvedValue({ user: { id: "5" } });
		state.rateLimit.mockResolvedValue({ ok: true });
		state.sendCurrency.mockResolvedValue(true);
		state.update.mockResolvedValue([{ affectedRows: 1 }]);
		state.insert.mockResolvedValue([{ insertId: 1 }]);
		state.settingsRows = [];
		state.referralsRows = [{ id: BIG_ID, referralsTotal: BIG_TEN }];
		state.settingsFail = false;
		state.referralsFail = false;
	});

	it("redirects to /login when unauthenticated or the session id is unusable", async () => {
		state.auth.mockResolvedValue({ user: { id: undefined } });
		await expect(claimReferral(new FormData())).rejects.toThrow("/login");
		state.auth.mockResolvedValue({ user: { id: "0" } });
		await expect(claimReferral(new FormData())).rejects.toThrow("/login");
		state.auth.mockResolvedValue({ user: { id: "abc" } });
		await expect(claimReferral(new FormData())).rejects.toThrow("/login");
		expect(state.update).not.toHaveBeenCalled();
		expect(state.sendCurrency).not.toHaveBeenCalled();
	});

	it("redirects with error=ratelimit when throttled", async () => {
		state.rateLimit.mockResolvedValue({ ok: false, retryAfter: 5 });
		await expect(claimReferral(new FormData())).rejects.toThrow(
			"/me?error=ratelimit",
		);
		expect(state.update).not.toHaveBeenCalled();
		expect(state.sendCurrency).not.toHaveBeenCalled();
		expect(state.revalidatePath).toHaveBeenCalledWith("/me");
	});

	it("grants the default reward (5 needed, 30 diamonds) and redirects to ?claimed=1", async () => {
		await expect(claimReferral(new FormData())).rejects.toThrow(
			"/me?claimed=1",
		);
		expect(state.update).toHaveBeenCalledWith(
			UserReferrals,
			expect.anything(),
			expect.anything(),
		);
		expect(state.sendCurrency).toHaveBeenCalledWith(
			expect.objectContaining({ rcon: expect.anything() }),
			5,
			"diamonds",
			30,
		);
		expect(state.insert).toHaveBeenCalledOnce();
		expect(state.insert.mock.calls[0][0]).toBe(ClaimedReferralLogs);
		expect(state.insert.mock.calls[0][1]).toMatchObject({
			userId: 5,
			ipAddress: "203.0.113.9",
			createdAt: expect.any(Date),
			updatedAt: expect.any(Date),
		});
		expect(state.revalidatePath).toHaveBeenCalledWith("/me");
	});

	it("applies CMS-configured threshold, currency and amount", async () => {
		state.settingsRows = [
			{ key: "referrals_needed", value: "2" },
			{ key: "referral_reward_amount", value: "75" },
			{ key: "referral_reward_currency_type", value: "points" },
		];
		await expect(claimReferral(new FormData())).rejects.toThrow(
			"/me?claimed=1",
		);
		expect(state.sendCurrency).toHaveBeenCalledWith(
			expect.anything(),
			5,
			"points",
			75,
		);
	});

	it("falls back to the short referral_reward_currency key when the type key is absent", async () => {
		state.settingsRows = [
			{ key: "referral_reward_amount", value: "10" },
			{ key: "referral_reward_currency", value: "credits" },
		];
		await expect(claimReferral(new FormData())).rejects.toThrow(
			"/me?claimed=1",
		);
		expect(state.sendCurrency).toHaveBeenCalledWith(
			expect.anything(),
			5,
			"credits",
			10,
		);
	});

	it("falls back to defaults when the settings query fails", async () => {
		state.settingsFail = true;
		await expect(claimReferral(new FormData())).rejects.toThrow(
			"/me?claimed=1",
		);
		expect(state.sendCurrency).toHaveBeenCalledWith(
			expect.anything(),
			5,
			"diamonds",
			30,
		);
	});

	it("rebukes users with no referrals row as no_referrals", async () => {
		state.referralsRows = [];
		await expect(claimReferral(new FormData())).rejects.toThrow(
			"/me?error=no_referrals",
		);
		expect(state.sendCurrency).not.toHaveBeenCalled();
	});

	it("treats a failed referrals read as no_referrals", async () => {
		state.referralsFail = true;
		await expect(claimReferral(new FormData())).rejects.toThrow(
			"/me?error=no_referrals",
		);
		expect(state.sendCurrency).not.toHaveBeenCalled();
	});

	it("rejects zero referrals as no_referrals", async () => {
		state.referralsRows = [{ id: BIG_ID, referralsTotal: 0n }];
		await expect(claimReferral(new FormData())).rejects.toThrow(
			"/me?error=no_referrals",
		);
	});

	it("rejects a tally below the threshold as not_enough", async () => {
		state.referralsRows = [{ id: BIG_ID, referralsTotal: 3n }];
		await expect(claimReferral(new FormData())).rejects.toThrow(
			"/me?error=not_enough",
		);
		expect(state.update).not.toHaveBeenCalled();
		expect(state.sendCurrency).not.toHaveBeenCalled();
	});

	it("rejects an unknown reward currency as bad_config without granting", async () => {
		state.settingsRows = [
			{ key: "referral_reward_currency_type", value: "Fragments" },
		];
		await expect(claimReferral(new FormData())).rejects.toThrow(
			"/me?error=bad_config",
		);
		expect(state.sendCurrency).not.toHaveBeenCalled();
	});

	it("rejects a non-positive or garbled reward amount as bad_config", async () => {
		state.settingsRows = [{ key: "referral_reward_amount", value: "abc" }];
		await expect(claimReferral(new FormData())).rejects.toThrow(
			"/me?error=bad_config",
		);
		state.settingsRows = [{ key: "referral_reward_amount", value: "-5" }];
		await expect(claimReferral(new FormData())).rejects.toThrow(
			"/me?error=bad_config",
		);
		expect(state.sendCurrency).not.toHaveBeenCalled();
	});

	it("rolls the threshold back when currency delivery fails and reports error", async () => {
		state.sendCurrency.mockRejectedValueOnce(new Error("rcon unavailable"));
		state.update.mockResolvedValueOnce([{ affectedRows: 1 }]);
		state.update.mockResolvedValueOnce([{ affectedRows: 1 }]);
		await expect(claimReferral(new FormData())).rejects.toThrow(
			"/me?error=error",
		);
		expect(state.update).toHaveBeenCalledTimes(2);
		expect(state.revalidatePath).toHaveBeenCalledWith("/me");
	});

	it("still reports error when the rollback sweep fails", async () => {
		state.sendCurrency.mockRejectedValueOnce(new Error("rcon unavailable"));
		state.update.mockResolvedValueOnce([{ affectedRows: 1 }]);
		state.update.mockRejectedValueOnce(new Error("rollback down"));
		await expect(claimReferral(new FormData())).rejects.toThrow(
			"/me?error=error",
		);
		expect(state.update).toHaveBeenCalledTimes(2);
	});

	it("still reports claimed when the audit log write fails (best-effort)", async () => {
		state.insert.mockRejectedValueOnce(new Error("log down"));
		await expect(claimReferral(new FormData())).rejects.toThrow(
			"/me?claimed=1",
		);
		expect(state.sendCurrency).toHaveBeenCalledTimes(1);
	});
});
