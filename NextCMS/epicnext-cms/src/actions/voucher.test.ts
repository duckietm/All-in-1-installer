// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
	NextResponse: {
		json: vi.fn(),
	},
}));

import { fakeForm } from "@/test/fake-form";

vi.mock("next-auth", () => ({
	default: vi.fn(() => ({
		handlers: {},
		auth: vi.fn(),
		signOut: vi.fn(),
	})),
}));

vi.mock("@/lib/auth", () => ({
	auth: vi.fn(),
	handlers: {},
	signOut: vi.fn(),
}));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({
	auth: mockAuth,
}));

const hoistedInsertValues = vi.hoisted(() => vi.fn());
const hoistedDeleteWhere = vi.hoisted(() => vi.fn());
const hoistedSelectLimit = vi.hoisted(() => vi.fn());
const hoistedSelectWhere = vi.hoisted(() =>
	vi.fn(() => ({ limit: hoistedSelectLimit })),
);
const hoistedSelectFrom = vi.hoisted(() =>
	vi.fn(() => ({ where: hoistedSelectWhere })),
);
const hoistedUpdateWhere = vi.hoisted(() => vi.fn());
const hoistedUpdateSetObj = vi.hoisted(() => ({
	set: vi.fn(() => ({ where: hoistedUpdateWhere })),
}));

vi.mock("@/lib/db", () => ({
	db: {
		select: vi.fn(() => ({ from: hoistedSelectFrom })),
		insert: vi.fn(() => ({ values: hoistedInsertValues })),
		update: vi.fn(() => hoistedUpdateSetObj),
		delete: vi.fn(() => ({ where: hoistedDeleteWhere })),
	},
	WebsiteShopVouchers: {
		id: "voucher.id",
		code: "voucher.code",
		amount: "voucher.amount",
		maxUses: "voucher.maxUses",
		useCount: "voucher.useCount",
		expiresAt: "voucher.expiresAt",
	},
	WebsiteUsedShopVouchers: {
		id: "used.id",
		userId: "used.userId",
		voucherId: "used.voucherId",
	},
}));

const mockSendCurrency = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/send-currency", () => ({
	currencyDb: {},
	sendCurrency: mockSendCurrency,
}));

const mockRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({
	clientIp: vi.fn().mockResolvedValue("127.0.0.1"),
	rateLimit: mockRateLimit,
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
	revalidatePath: mockRevalidatePath,
	unstable_cache: (fn: any) => fn,
}));

import { db } from "@/lib/db";
import { redeem } from "./voucher";

beforeEach(() => {
	vi.clearAllMocks();
	mockAuth.mockResolvedValue({ user: { id: "1" } });
	mockRateLimit.mockResolvedValue({ ok: true });
	hoistedSelectLimit.mockResolvedValue([]);
	hoistedInsertValues.mockResolvedValue([]);
	hoistedUpdateWhere.mockResolvedValue([]);
	mockSendCurrency.mockResolvedValue(undefined);
});

describe("redeem action", () => {
	it("rejects if user is not signed in", async () => {
		mockAuth.mockResolvedValueOnce(null);
		const result = await redeem(null, fakeForm({ code: "TEST" }));
		expect(result).toEqual({
			ok: false,
			message: "You must be signed in to redeem a voucher.",
		});
	});

	it("rejects if rate limited", async () => {
		mockRateLimit.mockResolvedValueOnce({ ok: false });
		const result = await redeem(null, fakeForm({ code: "TEST" }));
		expect(result?.ok).toBe(false);
		expect(result?.message).toContain("too fast");
	});

	it("rejects empty codes", async () => {
		const result = await redeem(null, fakeForm({ code: "" }));
		expect(result).toEqual({
			ok: false,
			message: "Please enter a voucher code.",
		});
	});

	it("rejects if voucher does not exist or is expired", async () => {
		hoistedSelectLimit.mockResolvedValueOnce([]); // voucher query
		const result = await redeem(null, fakeForm({ code: "INVALID" }));
		expect(result).toEqual({
			ok: false,
			message: "No active voucher with the given code was found.",
		});
	});

	it("successfully redeems a valid voucher", async () => {
		const futureDate = new Date(Date.now() + 86400000);
		// 1st call: voucher query, 2nd call: already used check, 3rd & 4th calls: bump useCount / check maxUses
		hoistedSelectLimit
			.mockResolvedValueOnce([
				{
					id: 10n,
					amount: 500,
					maxUses: 10,
					useCount: 2,
					expiresAt: futureDate,
				},
			])
			.mockResolvedValueOnce([]) // not used yet
			.mockResolvedValueOnce([{ maxUses: 10, useCount: 3 }]); // updated count

		const result = await redeem(null, fakeForm({ code: "VALIDCODE" }));
		expect(result?.ok).toBe(true);
		expect(result?.message).toContain("500 credits");
		expect(mockSendCurrency).toHaveBeenCalledWith(
			expect.any(Object),
			1,
			"credits",
			500,
		);
		expect(db.insert).toHaveBeenCalled();
	});
});
