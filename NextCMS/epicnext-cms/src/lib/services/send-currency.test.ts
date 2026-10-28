// @ts-nocheck
import { describe, expect, it, vi } from "vitest";
import { type CurrencyDb, sendCurrency } from "./send-currency";

vi.mock("@/lib/db", () => ({
	db: {},
	User: {},
	UsersCurrency: {},
}));

vi.mock("@/lib/services/rcon", () => ({}));

const mockDb = {} as CurrencyDb;

describe("sendCurrency", () => {
	it("returns false for non-positive amount", async () => {
		expect(
			await sendCurrency({ rcon: {} as never, db: mockDb }, 1, "credits", 0),
		).toBe(false);
		expect(
			await sendCurrency({ rcon: {} as never, db: mockDb }, 1, "credits", -5),
		).toBe(false);
		expect(
			await sendCurrency({ rcon: {} as never, db: mockDb }, 1, "credits", null),
		).toBe(false);
		expect(
			await sendCurrency(
				{ rcon: {} as never, db: mockDb },
				1,
				"credits",
				undefined,
			),
		).toBe(false);
	});

	it("delivers credits via RCON", async () => {
		const rcon = {
			giveCredits: vi.fn().mockResolvedValue(true),
			giveDuckets: vi.fn(),
			giveDiamonds: vi.fn(),
			givePointsGotw: vi.fn(),
		};
		const result = await sendCurrency(
			{
				rcon,
				db: { user: { update: vi.fn() }, usersCurrency: { upsert: vi.fn() } },
			},
			1,
			"credits",
			100,
		);
		expect(result).toBe(true);
		expect(rcon.giveCredits).toHaveBeenCalledWith(1, 100);
	});

	it("falls back to DB update when RCON fails for credits", async () => {
		const rcon = {
			giveCredits: vi.fn().mockResolvedValue(false),
			giveDuckets: vi.fn(),
			giveDiamonds: vi.fn(),
			givePointsGotw: vi.fn(),
		};
		const userUpdate = vi.fn().mockResolvedValue({});
		const result = await sendCurrency(
			{
				rcon,
				db: {
					user: { update: userUpdate },
					usersCurrency: { upsert: vi.fn() },
				},
			},
			1,
			"credits",
			100,
		);
		expect(result).toBe(true);
		expect(userUpdate).toHaveBeenCalledWith({
			where: { id: 1 },
			data: { credits: { increment: 100 } },
		});
	});

	it("delivers duckets via RCON", async () => {
		const rcon = {
			giveCredits: vi.fn(),
			giveDuckets: vi.fn().mockResolvedValue(true),
			giveDiamonds: vi.fn(),
			givePointsGotw: vi.fn(),
		};
		const result = await sendCurrency(
			{
				rcon,
				db: { user: { update: vi.fn() }, usersCurrency: { upsert: vi.fn() } },
			},
			1,
			"duckets",
			50,
		);
		expect(result).toBe(true);
		expect(rcon.giveDuckets).toHaveBeenCalledWith(1, 50);
	});

	it("upserts duckets in DB when RCON fails", async () => {
		const rcon = {
			giveCredits: vi.fn(),
			giveDuckets: vi.fn().mockResolvedValue(false),
			giveDiamonds: vi.fn(),
			givePointsGotw: vi.fn(),
		};
		const upsert = vi.fn().mockResolvedValue({});
		await sendCurrency(
			{
				rcon,
				db: { user: { update: vi.fn() }, usersCurrency: { upsert } },
			},
			1,
			"duckets",
			50,
		);
		expect(upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					userId_type: expect.objectContaining({ userId: 1, type: 0 }),
				}),
			}),
		);
	});

	it("upserts diamonds in DB when RCON fails", async () => {
		const rcon = {
			giveCredits: vi.fn(),
			giveDuckets: vi.fn(),
			giveDiamonds: vi.fn().mockResolvedValue(false),
			givePointsGotw: vi.fn(),
		};
		const upsert = vi.fn().mockResolvedValue({});
		await sendCurrency(
			{
				rcon,
				db: { user: { update: vi.fn() }, usersCurrency: { upsert } },
			},
			1,
			"diamonds",
			10,
		);
		expect(upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					userId_type: expect.objectContaining({ userId: 1, type: 5 }),
				}),
			}),
		);
	});

	it("upserts points in DB when RCON fails", async () => {
		const rcon = {
			giveCredits: vi.fn(),
			giveDuckets: vi.fn(),
			giveDiamonds: vi.fn(),
			givePointsGotw: vi.fn().mockResolvedValue(false),
		};
		const upsert = vi.fn().mockResolvedValue({});
		await sendCurrency(
			{
				rcon,
				db: { user: { update: vi.fn() }, usersCurrency: { upsert } },
			},
			1,
			"points",
			10,
		);
		expect(rcon.givePointsGotw).toHaveBeenCalled();
		expect(upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					userId_type: expect.objectContaining({ userId: 1, type: 101 }),
				}),
			}),
		);
	});
});
