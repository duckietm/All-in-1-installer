// @ts-nocheck
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	rewardState: {} as Record<string, unknown> | null,
	loadError: null as Error | null,
	insertError: null as Error | null,
	deleteError: null as Error | null,
	inserts: [] as { table: unknown; values: unknown }[],
	deletes: [] as { table: unknown; where: unknown }[],
	nextId: 1,
}));

const mockRedirect = vi.hoisted(() =>
	vi.fn((url: string) => {
		const err = new Error(`NEXT_REDIRECT: ${url}`);
		(err as never as { digest: string }).digest =
			`NEXT_REDIRECT;replace;${url};307;;`;
		throw err;
	}),
);
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
	revalidatePath: mockRevalidatePath,
	unstable_cache: (fn: unknown) => fn,
}));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));

const mockRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mockRateLimit }));

const mockLogger = vi.hoisted(() => ({
	error: vi.fn(),
	warn: vi.fn(),
	info: vi.fn(),
	debug: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

vi.mock("@/lib/services/daily-rewards", () => ({
	loadDailyRewardState: async () => {
		if (state.loadError) {
			const e = state.loadError;
			state.loadError = null;
			throw e;
		}
		return state.rewardState ?? {};
	},
	isRewardCurrency: (value: string) =>
		["credits", "duckets", "diamonds", "points"].includes(value),
}));

const mockSendCurrency = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/send-currency", () => ({
	currencyDb: { user: {}, usersCurrency: {} },
	sendCurrency: mockSendCurrency,
}));

vi.mock("@/lib/services/rcon", () => ({ rcon: {} }));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	return {
		...schema,
		db: {
			insert: (table: unknown) => ({
				values: (values: unknown) => {
					if (state.insertError) {
						const e = state.insertError;
						state.insertError = null;
						throw e;
					}
					state.inserts.push({ table, values });
					return [{ insertId: state.nextId }];
				},
			}),
			delete: (table: unknown) => ({
				where: (where: unknown) => {
					if (state.deleteError) {
						const e = state.deleteError;
						state.deleteError = null;
						throw e;
					}
					state.deletes.push({ table, where });
					return [{ affectedRows: 1 }];
				},
			}),
		},
	};
});

import { WebsiteDailyRewardClaims } from "@/lib/db";
import { claimDailyReward } from "./daily-reward";

function claimState(overrides: Record<string, unknown>) {
	return {
		enabled: true,
		today: "2026-09-21",
		alreadyClaimedToday: false,
		nextStreak: 3,
		nextReward: { day: 3, currency: "credits", amount: 100 },
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockAuth.mockReset();
	mockAuth.mockResolvedValue({ user: { id: "7" } });
	mockRateLimit.mockReset();
	mockRateLimit.mockResolvedValue({ ok: true });
	mockSendCurrency.mockReset();
	mockSendCurrency.mockResolvedValue(true);
	state.rewardState = null;
	state.loadError = null;
	state.insertError = null;
	state.deleteError = null;
	state.inserts = [];
	state.deletes = [];
	state.nextId = 100;
	mockRedirect.mockClear();
	mockRevalidatePath.mockClear();
});

describe("claimDailyReward", () => {
	it("redirects to login when not signed in", async () => {
		mockAuth.mockResolvedValueOnce(null);
		await expect(claimDailyReward(new FormData())).rejects.toThrow(
			"NEXT_REDIRECT: /login",
		);
	});

	it("redirects to login for a non-numeric or non-positive user id", async () => {
		mockAuth.mockResolvedValueOnce({ user: { id: "x" } });
		await expect(claimDailyReward(new FormData())).rejects.toThrow(
			"NEXT_REDIRECT: /login",
		);
		mockAuth.mockResolvedValueOnce({ user: { id: "0" } });
		await expect(claimDailyReward(new FormData())).rejects.toThrow(
			"NEXT_REDIRECT: /login",
		);
	});

	it("redirects with a ratelimit outcome when throttled", async () => {
		mockRateLimit.mockResolvedValueOnce({ ok: false });
		await expect(claimDailyReward(new FormData())).rejects.toThrow(
			"NEXT_REDIRECT: /me?daily=ratelimit",
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/me");
	});

	it("reports daily=disabled when the feature is off", async () => {
		state.rewardState = claimState({ enabled: false });
		await expect(claimDailyReward(new FormData())).rejects.toThrow(
			"NEXT_REDIRECT: /me?daily=disabled",
		);
	});

	it("reports already_claimed when the user claimed today", async () => {
		state.rewardState = claimState({ alreadyClaimedToday: true });
		await expect(claimDailyReward(new FormData())).rejects.toThrow(
			"NEXT_REDIRECT: /me?daily=already_claimed",
		);
	});

	it("reports bad_config when no reward is configured", async () => {
		state.rewardState = claimState({ nextReward: null });
		await expect(claimDailyReward(new FormData())).rejects.toThrow(
			"NEXT_REDIRECT: /me?daily=bad_config",
		);
	});

	it("reports bad_config for an unsupported currency", async () => {
		state.rewardState = claimState({
			nextReward: { day: 3, currency: "gems", amount: 100 },
		});
		await expect(claimDailyReward(new FormData())).rejects.toThrow(
			"NEXT_REDIRECT: /me?daily=bad_config",
		);
	});

	it("reports bad_config for a non-positive amount", async () => {
		state.rewardState = claimState({
			nextReward: { day: 3, currency: "credits", amount: 0 },
		});
		await expect(claimDailyReward(new FormData())).rejects.toThrow(
			"NEXT_REDIRECT: /me?daily=bad_config",
		);
	});

	it("inserts a claim, pays the reward and redirects to daily=claimed", async () => {
		state.rewardState = claimState({});
		await expect(claimDailyReward(new FormData())).rejects.toThrow(
			"NEXT_REDIRECT: /me?daily=claimed",
		);

		expect(state.inserts).toHaveLength(1);
		expect(state.inserts[0].table).toBe(WebsiteDailyRewardClaims);
		expect(state.inserts[0].values).toEqual({
			userId: 7,
			claimDate: new Date("2026-09-21T00:00:00Z"),
			streak: 3,
			rewardDay: 3,
			currency: "credits",
			amount: 100,
		});
		expect(mockSendCurrency).toHaveBeenCalledWith(
			{ rcon: expect.anything(), db: expect.anything() },
			7,
			"credits",
			100,
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/me");
	});

	it("treats a duplicate-key insert as already_claimed", async () => {
		state.rewardState = claimState({});
		state.insertError = Object.assign(new Error("dup"), {
			cause: { code: "ER_DUP_ENTRY" },
		});
		await expect(claimDailyReward(new FormData())).rejects.toThrow(
			"NEXT_REDIRECT: /me?daily=already_claimed",
		);
		expect(mockSendCurrency).not.toHaveBeenCalled();
	});

	it("logs and surfaces a generic insert failure as daily=error", async () => {
		state.rewardState = claimState({});
		state.insertError = new Error("db down");
		await expect(claimDailyReward(new FormData())).rejects.toThrow(
			"NEXT_REDIRECT: /me?daily=error",
		);
		expect(mockLogger.error).toHaveBeenCalledWith(
			"Daily reward claim insert failed",
			expect.objectContaining({ userId: 7 }),
		);
		expect(mockSendCurrency).not.toHaveBeenCalled();
	});

	it("rolls the claim back when the reward cannot be delivered", async () => {
		state.rewardState = claimState({});
		mockSendCurrency.mockRejectedValueOnce(new Error("rcon down"));
		await expect(claimDailyReward(new FormData())).rejects.toThrow(
			"NEXT_REDIRECT: /me?daily=error",
		);
		expect(state.deletes).toHaveLength(1);
		expect(state.deletes[0].table).toBe(WebsiteDailyRewardClaims);
		expect(state.deletes[0].where).toEqual(
			eq(WebsiteDailyRewardClaims.id, BigInt(100)),
		);
	});

	it("still reports error when the rollback delete also fails", async () => {
		state.rewardState = claimState({});
		mockSendCurrency.mockRejectedValueOnce(new Error("rcon down"));
		state.deleteError = new Error("rollback failed");
		await expect(claimDailyReward(new FormData())).rejects.toThrow(
			"NEXT_REDIRECT: /me?daily=error",
		);
	});

	it("swallows a non-redirect error from state loading into daily=error", async () => {
		state.loadError = new Error("state load failed");
		await expect(claimDailyReward(new FormData())).rejects.toThrow(
			"NEXT_REDIRECT: /me?daily=error",
		);
	});
});
