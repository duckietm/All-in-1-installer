// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type RowList = Row[];

const state = vi.hoisted(() => ({
	auth: vi.fn(async () => ({ user: { id: "5" } })),
	rateLimit: vi.fn(async () => ({ ok: true })),
	clientIp: vi.fn(async () => "203.0.113.9"),
	revalidatePath: vi.fn(),
	creditsPerUnit: vi.fn(() => 10),
	insert: vi.fn(async () => [{ insertId: 1 }]),
	update: vi.fn(async () => [{ affectedRows: 1 }]),
	transaction: vi.fn(),
	sendCurrency: vi.fn(async () => true),
	giveBadge: vi.fn(async () => undefined),
	logServerError: vi.fn(),
	articleRows: [] as RowList,
	userRows: [] as RowList,
	badgeRows: [] as RowList,
	badgeQueue: [] as RowList[],
	isBadge: false,
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
vi.mock("@/lib/services/paypal", () => ({
	creditsPerUnit: state.creditsPerUnit,
}));
vi.mock("@/lib/services/send-currency", () => ({
	sendCurrency: state.sendCurrency,
	currencyDb: { user: {}, usersCurrency: {} },
}));
vi.mock("@/lib/services/rcon", () => ({
	rcon: { giveBadge: state.giveBadge },
}));
vi.mock("@/lib/server-log", () => ({
	logServerError: state.logServerError,
}));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb(
		(table: unknown, _projection: Record<string, unknown>) => {
			if (table === schema.UsersBadges) {
				if (state.badgeQueue.length) return state.badgeQueue.shift() as RowList;
				return state.badgeRows;
			}
			if (table === schema.User) return state.userRows;
			if (table === schema.WebsiteShopArticles) return state.articleRows;
			return [];
		},
	);
	const db = {
		...fake,
		update: (table: unknown) => ({
			set: (values: unknown) => ({
				where: (where: unknown) => state.update(table, values, where),
			}),
		}),
		insert: (table: unknown) => ({
			values: (values: unknown) => state.insert(table, values),
		}),
		transaction: (fn: (tx: unknown) => Promise<unknown>) =>
			state.transaction(fn, db),
	};
	return { ...schema, db };
});

import { User, UsersBadges } from "@/lib/db";
import { buyShopArticle } from "./shop";

const ARTICLE: Row = {
	id: 3n,
	name: "StarterPack",
	costs: 100,
	credits: 20,
	duckets: 10,
	diamonds: 5,
	badges: "ABC,DEF",
	giveRank: null,
};

function shopForm(overrides: Record<string, string | undefined> = {}) {
	const f = new FormData();
	f.set("categoryId", "1");
	f.set("articleId", "3");
	for (const [k, v] of Object.entries(overrides)) {
		if (v === undefined) f.delete(k);
		else f.set(k, v);
	}
	return f;
}

describe("buyShopArticle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.auth.mockResolvedValue({ user: { id: "5" } });
		state.rateLimit.mockResolvedValue({ ok: true });
		state.creditsPerUnit.mockReturnValue(10);
		state.insert.mockResolvedValue([{ insertId: 1 }]);
		state.update.mockResolvedValue([{ affectedRows: 1 }]);
		state.sendCurrency.mockResolvedValue(true);
		state.giveBadge.mockResolvedValue(undefined);
		state.logServerError.mockImplementation(() => undefined);
		state.articleRows = [ARTICLE];
		state.userRows = [{ credits: 500, rank: 3 }];
		state.badgeRows = [];
		state.badgeQueue = [];
		state.isBadge = false;
		state.transaction.mockImplementation(
			async (fn: (tx: unknown) => Promise<unknown>, txDb: unknown) => fn(txDb),
		);
	});

	it("charges credits, grants configured currencies, badges and redirects with bought=1", async () => {
		await expect(buyShopArticle(shopForm())).rejects.toThrow(
			"/shop?category=1&bought=1&package=StarterPack",
		);
		expect(state.rateLimit).toHaveBeenCalledWith("shop-buy:5", 5, 60_000);
		expect(state.transaction).toHaveBeenCalled();
		expect(state.update).toHaveBeenCalledWith(
			User,
			expect.anything(),
			expect.anything(),
		);
		expect(state.insert).toHaveBeenCalledTimes(2);
		expect(state.insert.mock.calls[0][0]).toBe(UsersBadges);
		expect(state.insert.mock.calls[0][1]).toEqual({
			userId: 5,
			slotId: 1,
			badgeCode: "ABC",
		});
		expect(state.insert.mock.calls[1][1]).toEqual({
			userId: 5,
			slotId: 1,
			badgeCode: "DEF",
		});
		expect(state.sendCurrency).toHaveBeenCalledTimes(3);
		expect(state.sendCurrency).toHaveBeenCalledWith(
			expect.anything(),
			5,
			"credits",
			20,
		);
		expect(state.sendCurrency).toHaveBeenCalledWith(
			expect.anything(),
			5,
			"duckets",
			10,
		);
		expect(state.sendCurrency).toHaveBeenCalledWith(
			expect.anything(),
			5,
			"diamonds",
			5,
		);
		expect(state.giveBadge).toHaveBeenCalledTimes(2);
		expect(state.revalidatePath).toHaveBeenCalledWith("/shop");
	});

	it("omits the category query param when it is not numeric", async () => {
		await expect(
			buyShopArticle(shopForm({ categoryId: "abc" })),
		).rejects.toThrow("/shop?bought=1&package=StarterPack");
	});

	it("raises the buyer rank when the package grants a higher rank", async () => {
		state.articleRows = [{ ...ARTICLE, giveRank: 7 }];
		await expect(buyShopArticle(shopForm())).rejects.toThrow(
			"/shop?category=1&bought=1",
		);
		expect(state.update).toHaveBeenCalledWith(
			User,
			expect.objectContaining({ rank: 7 }),
			expect.anything(),
		);
	});

	it("does not lower or equal a rank, nor bump it for a null giveRank", async () => {
		state.articleRows = [{ ...ARTICLE, giveRank: 2 }];
		await expect(buyShopArticle(shopForm())).rejects.toThrow(
			"/shop?category=1&bought=1",
		);
		state.articleRows = [{ ...ARTICLE, giveRank: null }];
		await expect(buyShopArticle(shopForm())).rejects.toThrow(
			"/shop?category=1&bought=1",
		);
		expect(state.update).toHaveBeenCalledTimes(2);
		expect(state.update).not.toHaveBeenCalledWith(
			User,
			expect.objectContaining({ rank: expect.anything() }),
			expect.anything(),
		);
	});

	it("skips an RCON badge grant when the emulator errors and logs the failure", async () => {
		state.giveBadge.mockRejectedValue(new Error("emulator offline"));
		await expect(buyShopArticle(shopForm())).rejects.toThrow(
			"/shop?category=1&bought=1",
		);
		expect(state.logServerError).toHaveBeenCalledTimes(2);
		expect(state.logServerError).toHaveBeenCalledWith(
			"shop.give_badge_failed",
			expect.any(Error),
			expect.objectContaining({ userId: 5, code: "ABC" }),
		);
	});

	it("ignores badge codes longer than 32 characters or whitespace", async () => {
		state.articleRows = [
			{
				...ARTICLE,
				badges: "OK,, ,  VERYLONG_badge_code_that_exceeds_32_chars",
			},
		];
		await expect(buyShopArticle(shopForm())).rejects.toThrow(
			"/shop?category=1&bought=1",
		);
		expect(state.insert).toHaveBeenCalledTimes(1);
		expect(state.insert.mock.calls[0][1]).toMatchObject({ badgeCode: "OK" });
		expect(state.giveBadge).toHaveBeenCalledTimes(1);
		expect(state.giveBadge).toHaveBeenCalledWith(5, "OK");
	});

	it("does not re-issue a badge the user already owns", async () => {
		state.badgeRows = [{ id: 1 }, { id: 2 }];
		await expect(buyShopArticle(shopForm())).rejects.toThrow(
			"/shop?category=1&bought=1",
		);
		expect(state.insert).not.toHaveBeenCalled();
		expect(state.giveBadge).toHaveBeenCalledTimes(2);
	});

	it("continues badge slot numbers from the highest open slot", async () => {
		state.badgeQueue = [[], [{ maxSlot: 4 }], [], [{ maxSlot: 9 }]];
		await expect(buyShopArticle(shopForm())).rejects.toThrow(
			"/shop?category=1&bought=1",
		);
		expect(state.insert).toHaveBeenCalledTimes(2);
		expect(state.insert.mock.calls[0][1]).toMatchObject({
			badgeCode: "ABC",
			slotId: 5,
		});
		expect(state.insert.mock.calls[1][1]).toMatchObject({
			badgeCode: "DEF",
			slotId: 10,
		});
	});

	it("prices sub-1.00 packages at one dollar worth of credits", async () => {
		state.articleRows = [{ ...ARTICLE, costs: 50 }];
		state.userRows = [{ credits: 5, rank: 3 }];
		// costs 50 -> dollars 1 -> price = 1 * rate(10) = 10; buyer has 5, not enough.
		await expect(buyShopArticle(shopForm())).rejects.toThrow(
			"/shop?category=1&error=credits",
		);
		expect(state.transaction).not.toHaveBeenCalled();

		state.userRows = [{ credits: 500, rank: 3 }];
		await expect(buyShopArticle(shopForm())).rejects.toThrow(
			"/shop?category=1&bought=1",
		);
		expect(state.transaction).toHaveBeenCalled();
	});

	it("rejects with credits when the buyer cannot cover the price", async () => {
		state.userRows = [{ credits: 5, rank: 3 }];
		await expect(buyShopArticle(shopForm())).rejects.toThrow(
			"/shop?category=1&error=credits",
		);
		expect(state.transaction).not.toHaveBeenCalled();

		state.userRows = [];
		await expect(buyShopArticle(shopForm())).rejects.toThrow(
			"/shop?category=1&error=credits",
		);
		expect(state.transaction).not.toHaveBeenCalled();
		expect(state.sendCurrency).not.toHaveBeenCalled();
	});

	it("rejects a non-numeric article id as invalid", async () => {
		await expect(
			buyShopArticle(shopForm({ articleId: "t-shirt" })),
		).rejects.toThrow("/shop?category=1&error=invalid");
		await expect(
			buyShopArticle(shopForm({ articleId: "4.5" })),
		).rejects.toThrow("/shop?category=1&error=invalid");
		expect(state.transaction).not.toHaveBeenCalled();
	});

	it("rejects an unknown article as invalid", async () => {
		state.articleRows = [];
		await expect(buyShopArticle(shopForm())).rejects.toThrow(
			"/shop?category=1&error=invalid",
		);
		expect(state.transaction).not.toHaveBeenCalled();
	});

	it("redirects with error=ratelimit when throttled", async () => {
		state.rateLimit.mockResolvedValue({ ok: false, retryAfter: 30 });
		await expect(buyShopArticle(shopForm())).rejects.toThrow(
			"/shop?category=1&error=ratelimit",
		);
		expect(state.transaction).not.toHaveBeenCalled();
	});

	it("redirects to /login when unauthenticated", async () => {
		state.auth.mockResolvedValue({ user: { id: undefined } });
		await expect(buyShopArticle(shopForm())).rejects.toThrow("/login");
		state.auth.mockResolvedValue({ user: { id: "0" } });
		await expect(buyShopArticle(shopForm())).rejects.toThrow("/login");
		expect(state.transaction).not.toHaveBeenCalled();
	});

	it("surfaces transaction failures as error=error and never auto-signals sends", async () => {
		state.transaction.mockRejectedValue(new Error("tx deadlock"));
		await expect(buyShopArticle(shopForm())).rejects.toThrow(
			"/shop?category=1&error=error",
		);
		expect(state.sendCurrency).not.toHaveBeenCalled();
		expect(state.revalidatePath).toHaveBeenCalledWith("/shop");
	});

	it("surfaces currency delivery failures as error=error", async () => {
		state.sendCurrency.mockRejectedValueOnce(new Error("wallet down"));
		await expect(buyShopArticle(shopForm())).rejects.toThrow(
			"/shop?category=1&error=error",
		);
	});

	it("prices a zero-cost package at one dollar worth of credits but still charges a nonzero amount", async () => {
		state.articleRows = [{ ...ARTICLE, costs: 0 }];
		await expect(buyShopArticle(shopForm())).rejects.toThrow(
			"/shop?category=1&bought=1",
		);
		const updateCall = state.update.mock.calls[0] as [
			unknown,
			Record<string, unknown>,
		];
		expect(updateCall[1]).toHaveProperty("credits");
	});
});
