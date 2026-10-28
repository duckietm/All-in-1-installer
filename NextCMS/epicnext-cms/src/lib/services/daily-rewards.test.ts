// @ts-nocheck
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("./site-settings", () => ({
	siteSettings: { getBool: async () => true },
}));

import {
	type DailyRewardRow,
	rewardForStreak,
	shiftDayKey,
} from "./daily-rewards";

describe("daily reward date math", () => {
	it("shifts day keys across month and year boundaries", () => {
		expect(shiftDayKey("2026-03-01", -1)).toBe("2026-02-28");
		expect(shiftDayKey("2026-01-01", 31)).toBe("2026-02-01");
		expect(shiftDayKey("2026-12-31", 1)).toBe("2027-01-01");
		expect(shiftDayKey("2026-02-28", 1)).toBe("2026-03-01");
	});
});

describe("daily reward streak resolution", () => {
	const rewards: DailyRewardRow[] = [
		{ id: "1", day: 1, currency: "duckets", amount: 50 },
		{ id: "2", day: 2, currency: "duckets", amount: 60 },
		{ id: "5", day: 5, currency: "diamonds", amount: 2 },
	];

	it("resolves configured days and repeats the cycle", () => {
		expect(rewardForStreak(rewards, 1)?.day).toBe(1);
		expect(rewardForStreak(rewards, 2)?.day).toBe(2);
		expect(rewardForStreak(rewards, 5)?.day).toBe(5);
		// The cycle is the highest configured day: 5 → back to day 1.
		expect(rewardForStreak(rewards, 6)?.day).toBe(1);
		expect(rewardForStreak(rewards, 7)?.day).toBe(2);
		expect(rewardForStreak(rewards, 10)?.day).toBe(5);
	});

	it("falls back to the day-1 reward for unconfigured days", () => {
		// Days 3 and 4 are not configured in the schedule → day-1 reward.
		expect(rewardForStreak(rewards, 3)?.day).toBe(1);
		expect(rewardForStreak(rewards, 4)?.day).toBe(1);
	});

	it("returns null for empty schedules or non-positive streaks", () => {
		expect(rewardForStreak([], 3)).toBeNull();
		expect(
			rewardForStreak(
				[{ id: "1", day: 3, currency: "credits", amount: 10 }],
				0,
			),
		).toBeNull();
	});
});
