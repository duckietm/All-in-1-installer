// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	badges: [] as (
		| { id: number; badgePath: string; published: boolean }
		| undefined
	)[],
	buyers: [] as { credits: number }[],
	price: "50",
	txExisting: [] as { id: number }[],
	txMax: null as number | null,
	txError: null as Error | null,
	txUpdates: [] as { table: unknown; values: unknown }[],
	txInserted: [] as { table: unknown; values: unknown }[],
	giveBadgeError: null as Error | null,
	caughtErrors: [] as unknown[],
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

const mockClientIp = vi.hoisted(() => vi.fn());
const mockRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({
	clientIp: mockClientIp,
	rateLimit: mockRateLimit,
}));

const mockLogServerError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server-log", () => ({ logServerError: mockLogServerError }));

const mockGiveBadge = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/rcon", () => ({ rcon: { giveBadge: mockGiveBadge } }));

const mockSiteSettingsGet = vi.hoisted(() => vi.fn(async () => state.price));
vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: { get: mockSiteSettingsGet },
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");

	function txSelect(fields: unknown) {
		const isExisting = (fields as { id?: unknown }).id !== undefined;
		return {
			from: () => ({
				where: () => {
					const rows = isExisting
						? state.txExisting
						: [{ maxSlot: state.txMax }];
					return Object.assign([...rows], {
						limit: () => Object.assign([...rows], {}),
					});
				},
			}),
		};
	}

	return {
		...schema,
		db: {
			select: (fields: unknown) => {
				const isCredits =
					(fields as { credits?: unknown }).credits !== undefined;
				return {
					from: () => ({
						where: () => {
							const rows = isCredits ? state.buyers : state.badges;
							return Object.assign([...rows], {
								limit: () => Object.assign([...rows], {}),
							});
						},
					}),
				};
			},
			transaction: (fn: (t: unknown) => unknown) =>
				fn({
					update: (table: unknown) => ({
						set: (values: unknown) => ({
							where: () => {
								try {
									if (state.txError) {
										const e = state.txError;
										state.txError = null;
										throw e;
									}
									state.txUpdates.push({ table, values });
									return [{ affectedRows: 1 }];
								} catch (e) {
									state.caughtErrors.push(e);
									throw e;
								}
							},
						}),
					}),
					select: txSelect,
					insert: (table: unknown) => ({
						values: (values: unknown) => {
							try {
								if (state.txError) {
									const e = state.txError;
									state.txError = null;
									throw e;
								}
								state.txInserted.push({ table, values });
								return [{ insertId: 1 }];
							} catch (e) {
								state.caughtErrors.push(e);
								throw e;
							}
						},
					}),
				}),
		},
	};
});

import { User, UsersBadges } from "@/lib/db";
import { buyBadge } from "./draw-badge";

beforeEach(() => {
	vi.clearAllMocks();
	mockAuth.mockReset();
	mockAuth.mockResolvedValue({ user: { id: "7" } });
	mockClientIp.mockReset();
	mockClientIp.mockResolvedValue("127.0.0.1");
	mockRateLimit.mockReset();
	mockRateLimit.mockResolvedValue({ ok: true });
	mockGiveBadge.mockReset();
	mockGiveBadge.mockResolvedValue(true);
	state.price = "50";
	state.badges = [];
	state.buyers = [];
	state.txExisting = [];
	state.txMax = null;
	state.txError = null;
	state.txUpdates = [];
	state.txInserted = [];
	state.giveBadgeError = null;
	mockRedirect.mockClear();
	mockRevalidatePath.mockClear();
	mockLogServerError.mockClear();
});

function form(id: string) {
	const f = new FormData();
	f.set("id", id);
	return f;
}

describe("buyBadge", () => {
	it("redirects to login when not signed in", async () => {
		mockAuth.mockResolvedValueOnce(null);
		await expect(buyBadge(form("1"))).rejects.toThrow("NEXT_REDIRECT: /login");
	});

	it("redirects to login for a non-numeric user id", async () => {
		mockAuth.mockResolvedValueOnce({ user: { id: "abc" } });
		await expect(buyBadge(form("1"))).rejects.toThrow("NEXT_REDIRECT: /login");
	});

	it("rejects a missing or malformed badge id before any work", async () => {
		await expect(buyBadge(form(""))).rejects.toThrow(
			"NEXT_REDIRECT: /draw-badge?error=invalid",
		);
		await expect(buyBadge(form("1abc"))).rejects.toThrow(
			"NEXT_REDIRECT: /draw-badge?error=invalid",
		);
		await expect(buyBadge(form("1.5"))).rejects.toThrow(
			"NEXT_REDIRECT: /draw-badge?error=invalid",
		);
		expect(mockRevalidatePath).not.toHaveBeenCalled();
		expect(mockRateLimit).not.toHaveBeenCalled();
	});

	it("redirects with a ratelimit outcome when throttled", async () => {
		mockRateLimit.mockResolvedValueOnce({ ok: false });
		await expect(buyBadge(form("1"))).rejects.toThrow(
			"NEXT_REDIRECT: /draw-badge?error=ratelimit",
		);
		expect(mockRateLimit).toHaveBeenCalledWith("draw-badge-buy:7", 5, 60_000);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/draw-badge");
	});

	it("reports invalid when the badge row does not exist", async () => {
		state.badges = [];
		await expect(buyBadge(form("1"))).rejects.toThrow(
			"NEXT_REDIRECT: /draw-badge?error=invalid",
		);
	});

	it("reports invalid for an unpublished badge", async () => {
		state.badges = [{ id: 1, badgePath: "MYBADGE.gif", published: false }];
		await expect(buyBadge(form("1"))).rejects.toThrow(
			"NEXT_REDIRECT: /draw-badge?error=invalid",
		);
	});

	it("reports invalid when the derived badge code is empty", async () => {
		state.badges = [{ id: 1, badgePath: "!!!", published: true }];
		await expect(buyBadge(form("1"))).rejects.toThrow(
			"NEXT_REDIRECT: /draw-badge?error=invalid",
		);
	});

	it("reports credits when the buyer has too few credits", async () => {
		state.badges = [{ id: 1, badgePath: "MYBADGE.gif", published: true }];
		state.buyers = [{ credits: 10 }];
		await expect(buyBadge(form("1"))).rejects.toThrow(
			"NEXT_REDIRECT: /draw-badge?error=credits",
		);
	});

	it("reports credits when the buyer row does not exist", async () => {
		state.badges = [{ id: 1, badgePath: "MYBADGE.gif", published: true }];
		state.buyers = [];
		await expect(buyBadge(form("1"))).rejects.toThrow(
			"NEXT_REDIRECT: /draw-badge?error=credits",
		);
	});

	it("buys a new badge, deducts credits and redirects with the code", async () => {
		state.badges = [
			{ id: 1, badgePath: "album1584/MYBADGE.gif", published: true },
		];
		state.buyers = [{ credits: 100 }];
		state.txMax = 4;

		await expect(buyBadge(form("1"))).rejects.toThrow(
			"NEXT_REDIRECT: /draw-badge?bought=MYBADGE",
		);

		expect(mockSiteSettingsGet).toHaveBeenCalledWith("drawbadge.price", "50");
		expect(state.txUpdates).toHaveLength(1);
		expect(state.txUpdates[0].table).toBe(User);
		expect(state.txUpdates[0].values).toEqual({
			credits: expect.objectContaining({ queryChunks: expect.any(Array) }),
		});
		expect(state.txInserted).toHaveLength(1);
		expect(state.txInserted[0].table).toBe(UsersBadges);
		expect(state.txInserted[0].values).toEqual({
			userId: 7,
			slotId: 5,
			badgeCode: "MYBADGE",
		});
		expect(mockGiveBadge).toHaveBeenCalledWith(7, "MYBADGE");
		expect(mockRevalidatePath).toHaveBeenCalledWith("/draw-badge");
		console.log(
			"DEBUG caught:",
			state.caughtErrors.map((e) => (e as Error).message ?? e),
		);
	});

	it("updates an existing badge slot instead of creating a new one", async () => {
		state.badges = [{ id: 1, badgePath: "MYBADGE.gif", published: true }];
		state.buyers = [{ credits: 100 }];
		state.txExisting = [{ id: 9 }];

		await expect(buyBadge(form("1"))).rejects.toThrow(
			"NEXT_REDIRECT: /draw-badge?bought=MYBADGE",
		);
		expect(state.txInserted).toHaveLength(0);
		expect(mockGiveBadge).toHaveBeenCalledWith(7, "MYBADGE");
	});

	it("uses an empty slot when no existing badge slots exist", async () => {
		state.badges = [{ id: 1, badgePath: "MYBADGE.gif", published: true }];
		state.buyers = [{ credits: 100 }];
		state.txMax = null;

		await expect(buyBadge(form("1"))).rejects.toThrow(
			"NEXT_REDIRECT: /draw-badge?bought=MYBADGE",
		);
		expect(state.txInserted[0].values).toEqual({
			userId: 7,
			slotId: 1,
			badgeCode: "MYBADGE",
		});
	});

	it("skips the ledger transaction when the price is zero", async () => {
		state.price = "0";
		state.badges = [{ id: 1, badgePath: "FREE.gif", published: true }];
		state.buyers = [{ credits: 0 }];

		await expect(buyBadge(form("1"))).rejects.toThrow(
			"NEXT_REDIRECT: /draw-badge?bought=FREE",
		);
		expect(state.txUpdates).toHaveLength(0);
		expect(state.txInserted).toHaveLength(0);
		expect(mockGiveBadge).toHaveBeenCalledWith(7, "FREE");
	});

	it("falls back to the default price for an invalid setting", async () => {
		state.price = "abc";
		state.badges = [{ id: 1, badgePath: "MYBADGE.gif", published: true }];
		state.buyers = [{ credits: 100 }];
		state.txMax = 0;

		await expect(buyBadge(form("1"))).rejects.toThrow(
			"NEXT_REDIRECT: /draw-badge?bought=MYBADGE",
		);
		expect(state.txUpdates[0].values).toEqual({
			credits: expect.objectContaining({ queryChunks: expect.any(Array) }),
		});
	});

	it("still counts the purchase when the live rcon grant fails", async () => {
		state.badges = [{ id: 1, badgePath: "MYBADGE.gif", published: true }];
		state.buyers = [{ credits: 100 }];
		state.txMax = 0;
		mockGiveBadge.mockRejectedValueOnce(new Error("emulator down"));

		await expect(buyBadge(form("1"))).rejects.toThrow(
			"NEXT_REDIRECT: /draw-badge?bought=MYBADGE",
		);
		expect(mockLogServerError).toHaveBeenCalledWith(
			"drawbadge.give_failed",
			expect.objectContaining({ message: "emulator down" }),
			{ userId: 7, code: "MYBADGE" },
		);
	});

	it("strips unsafe characters and caps the badge code at 32 characters", async () => {
		const long = `${"a".repeat(40)}!bad.gif`;
		state.badges = [{ id: 1, badgePath: long, published: true }];
		state.buyers = [{ credits: 100 }];
		state.txMax = 0;

		await expect(buyBadge(form("1"))).rejects.toThrow(
			`NEXT_REDIRECT: /draw-badge?bought=${"a".repeat(32)}`,
		);
	});

	it("reports fail when an unexpected error is thrown inside the transaction", async () => {
		state.badges = [{ id: 1, badgePath: "MYBADGE.gif", published: true }];
		state.buyers = [{ credits: 100 }];
		state.txError = new Error("tx exploded");

		await expect(buyBadge(form("1"))).rejects.toThrow(
			"NEXT_REDIRECT: /draw-badge?error=fail",
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/draw-badge");
	});

	it("reports fail when the ip lookup throws", async () => {
		mockClientIp.mockRejectedValueOnce(new Error("ip failed"));

		await expect(buyBadge(form("1"))).rejects.toThrow(
			"NEXT_REDIRECT: /draw-badge?error=fail",
		);
	});
});
