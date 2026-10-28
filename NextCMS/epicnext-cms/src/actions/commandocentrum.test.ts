// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	allowed: true,
	authenticated: true,
	isSuperAdmin: false,
	target: [] as { rank: number }[],
	rankRows: [] as { id: number }[],
	rankRowsError: null as Error | null,
	userUpdates: [] as { values: unknown }[],
}));

const mockGetApiAdminContext = vi.hoisted(() => vi.fn());
const mockCanAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/permissions", async () => {
	const { PERMS } = await import("@/lib/permission-slugs");
	return {
		PERMS,
		getApiAdminContext: mockGetApiAdminContext,
		canAccess: mockCanAccess,
	};
});

// The rank check reads the target from the database; here it only answers.
const mockGuardRank = vi.hoisted(() =>
	vi.fn(async () => ({ username: "bob", rank: 1 })),
);
vi.mock("@/lib/admin/rank-guard", () => ({ guardRank: mockGuardRank }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/admin/authorization-events", () => ({
	logAuthorizationEvent: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/foundation/security", () => ({
	extractClientIpAsync: async () => "127.0.0.1",
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
	revalidatePath: mockRevalidatePath,
	unstable_cache: (fn: unknown) => fn,
}));

const mockSend = vi.hoisted(() => vi.fn());
const mockUpdateCatalog = vi.hoisted(() => vi.fn());
const mockUpdateWordFilter = vi.hoisted(() => vi.fn());
const mockDisconnectUser = vi.hoisted(() => vi.fn());
const mockAlertUser = vi.hoisted(() => vi.fn());
const mockForwardUser = vi.hoisted(() => vi.fn());
const mockGiveCredits = vi.hoisted(() => vi.fn());
const mockGiveDuckets = vi.hoisted(() => vi.fn());
const mockGiveDiamonds = vi.hoisted(() => vi.fn());
const mockGiveBadge = vi.hoisted(() => vi.fn());
const mockSetMotto = vi.hoisted(() => vi.fn());
const mockSetRank = vi.hoisted(() => vi.fn());
const mockExecuteCommand = vi.hoisted(() => vi.fn());
const mockSendGift = vi.hoisted(() => vi.fn());
// The audit service is exercised separately; here it only has to be harmless.
// Mocked explicitly because the fake db has no `insert`, which used to leak an
// unhandled rejection out of the fire-and-forget audit call.
vi.mock("@/lib/services/audit", () => ({
	logAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/services/rcon", () => ({
	rcon: {
		send: mockSend,
		updateCatalog: mockUpdateCatalog,
		updateWordFilter: mockUpdateWordFilter,
		disconnectUser: mockDisconnectUser,
		alertUser: mockAlertUser,
		forwardUser: mockForwardUser,
		giveCredits: mockGiveCredits,
		giveDuckets: mockGiveDuckets,
		giveDiamonds: mockGiveDiamonds,
		giveBadge: mockGiveBadge,
		setMotto: mockSetMotto,
		setRank: mockSetRank,
		executeCommand: mockExecuteCommand,
		sendGift: mockSendGift,
	},
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	return {
		...schema,
		queryRows: async () => {
			if (state.rankRowsError) {
				const e = state.rankRowsError;
				state.rankRowsError = null;
				throw e;
			}
			return state.rankRows;
		},
		db: {
			select: () => ({
				from: () => ({
					where: () => ({
						limit: () => state.target,
					}),
				}),
			}),
			update: (table: unknown) => ({
				set: (values: unknown) => ({
					where: () => {
						state.userUpdates.push({ table, values });
						return [{ affectedRows: 1 }];
					},
				}),
			}),
		},
	};
});

import {
	alertUser,
	disconnectUser,
	executeCommand,
	forwardUser,
	giveBadge,
	giveCredits,
	giveDiamonds,
	giveDuckets,
	hotelAlert,
	sendGift,
	setMotto,
	setRank,
	updateCatalog,
	updateNavigator,
	updateWordFilter,
} from "./commandocentrum";

const RCON_FAIL = "RCON command failed. Is the emulator running?";

function session() {
	return {
		session: { user: { id: 42, rank: 7, name: "admin" } },
		permissions: { isSuperAdmin: state.isSuperAdmin },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	state.allowed = true;
	state.authenticated = true;
	state.isSuperAdmin = false;
	state.target = [];
	state.rankRows = [{ id: 1 }];
	state.rankRowsError = null;
	state.userUpdates = [];
	mockGetApiAdminContext.mockReset();
	mockGetApiAdminContext.mockImplementation(async () =>
		state.authenticated ? session() : null,
	);
	mockCanAccess.mockImplementation(() => state.allowed);
	mockUpdateCatalog.mockReset();
	mockUpdateCatalog.mockResolvedValue(true);
	mockUpdateWordFilter.mockResolvedValue(true);
	mockSend.mockResolvedValue(true);
	mockDisconnectUser.mockResolvedValue(true);
	mockAlertUser.mockResolvedValue(true);
	mockForwardUser.mockResolvedValue(true);
	mockGiveCredits.mockResolvedValue(true);
	mockGiveDuckets.mockResolvedValue(true);
	mockGiveDiamonds.mockResolvedValue(true);
	mockGiveBadge.mockResolvedValue(true);
	mockSetMotto.mockResolvedValue(true);
	mockSetRank.mockResolvedValue(true);
	mockExecuteCommand.mockResolvedValue(true);
	mockSendGift.mockResolvedValue(true);
	mockRevalidatePath.mockClear();
});

describe("simple rcon commands", () => {
	it.each([
		["updateCatalog", updateCatalog, () => mockUpdateCatalog],
		["updateWordFilter", updateWordFilter, () => mockUpdateWordFilter],
	] as const)("%s succeeds and revalidates", async (_name, action, rconFn) => {
		await expect(action()).resolves.toEqual({ ok: true, data: {} });
		expect(rconFn()).toHaveBeenCalled();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/commandocentrum");
	});

	it("updateCatalog fails when rcon reports failure", async () => {
		mockUpdateCatalog.mockResolvedValueOnce(false);
		await expect(updateCatalog()).resolves.toEqual({
			ok: false,
			error: RCON_FAIL,
		});
	});
});

describe("updateNavigator", () => {
	it("sends a null payload and revalidates", async () => {
		await expect(updateNavigator()).resolves.toEqual({ ok: true, data: {} });
		expect(mockSend).toHaveBeenCalledWith("updatenavigator", null);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/commandocentrum");
	});

	it("fails when rcon reports failure", async () => {
		mockSend.mockResolvedValueOnce(false);
		await expect(updateNavigator()).resolves.toEqual({
			ok: false,
			error: RCON_FAIL,
		});
	});
});

describe("hotelAlert", () => {
	it("broadcasts a normalized message", async () => {
		await expect(hotelAlert({ message: "  hello " })).resolves.toEqual({
			ok: true,
			data: {},
		});
		expect(mockSend).toHaveBeenCalledWith("hotelalert", {
			message: "hello",
		});
	});

	it("rejects a blank message", async () => {
		const result = await hotelAlert({ message: "   " });
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Validation failed");
	});

	it("rejects an over-long message", async () => {
		const result = await hotelAlert({ message: "x".repeat(513) });
		expect(result.ok).toBe(false);
	});

	it("fails when delivery fails", async () => {
		mockSend.mockResolvedValueOnce(false);
		await expect(hotelAlert({ message: "hi" })).resolves.toEqual({
			ok: false,
			error: RCON_FAIL,
		});
	});
});

describe("disconnectUser", () => {
	it("disconnects the target user", async () => {
		await expect(
			disconnectUser({ userId: 5, username: "bob" }),
		).resolves.toEqual({ ok: true, data: {} });
		expect(mockDisconnectUser).toHaveBeenCalledWith(5, "bob");
	});

	it("rejects a blank username", async () => {
		const result = await disconnectUser({ userId: 5, username: " " });
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Validation failed");
	});
});

describe("rank check on user-targeted actions", () => {
	it("refuses to run a command as a user of the same or a higher rank", async () => {
		const { ActionError } = await import("@/lib/safe-action-shared");
		mockGuardRank.mockRejectedValueOnce(
			new ActionError("Cannot modify user with equal or higher rank"),
		);
		const result = await executeCommand({
			userId: 1,
			command: ":giverank me 7",
		});
		expect(result.ok).toBe(false);
		expect(mockExecuteCommand).not.toHaveBeenCalled();
	});
});

describe("alertUser", () => {
	it("alerts a specific user", async () => {
		await expect(alertUser({ userId: 3, message: "m" })).resolves.toEqual({
			ok: true,
			data: {},
		});
		expect(mockAlertUser).toHaveBeenCalledWith(3, "m");
	});

	it("fails when delivery fails", async () => {
		mockAlertUser.mockResolvedValueOnce(false);
		await expect(alertUser({ userId: 3, message: "m" })).resolves.toEqual({
			ok: false,
			error: RCON_FAIL,
		});
	});
});

describe("forwardUser", () => {
	it("forwards a user to a room", async () => {
		await expect(forwardUser({ userId: 4, roomId: 9 })).resolves.toEqual({
			ok: true,
			data: {},
		});
		expect(mockForwardUser).toHaveBeenCalledWith(4, 9);
	});
});

describe("giveCredits / giveDuckets / giveDiamonds", () => {
	it("gives credits", async () => {
		await expect(giveCredits({ userId: 1, credits: 100 })).resolves.toEqual({
			ok: true,
			data: {},
		});
		expect(mockGiveCredits).toHaveBeenCalledWith(1, 100);
	});

	it("gives duckets", async () => {
		await expect(giveDuckets({ userId: 1, amount: 50 })).resolves.toEqual({
			ok: true,
			data: {},
		});
		expect(mockGiveDuckets).toHaveBeenCalledWith(1, 50);
	});

	it("gives diamonds", async () => {
		await expect(giveDiamonds({ userId: 1, amount: 25 })).resolves.toEqual({
			ok: true,
			data: {},
		});
		expect(mockGiveDiamonds).toHaveBeenCalledWith(1, 25);
	});

	it("rejects negative amounts", async () => {
		await expect(giveCredits({ userId: 1, credits: 0 })).resolves.toMatchObject(
			{
				ok: false,
				error: "Validation failed",
			},
		);
	});
});

describe("giveBadge / setMotto / executeCommand", () => {
	it("gives a badge", async () => {
		await expect(giveBadge({ userId: 2, badge: " B1 " })).resolves.toEqual({
			ok: true,
			data: {},
		});
		expect(mockGiveBadge).toHaveBeenCalledWith(2, "B1");
	});

	it("sets a motto", async () => {
		await expect(setMotto({ userId: 2, motto: "hey" })).resolves.toEqual({
			ok: true,
			data: {},
		});
		expect(mockSetMotto).toHaveBeenCalledWith(2, "hey");
	});

	it("executes a command as a user", async () => {
		await expect(
			executeCommand({ userId: 2, command: ":flag" }),
		).resolves.toEqual({ ok: true, data: {} });
		expect(mockExecuteCommand).toHaveBeenCalledWith(2, ":flag");
	});

	it("fails when delivery fails", async () => {
		mockGiveBadge.mockResolvedValueOnce(false);
		await expect(giveBadge({ userId: 2, badge: "B1" })).resolves.toEqual({
			ok: false,
			error: RCON_FAIL,
		});
	});
});

describe("sendGift", () => {
	it("uses the default message when none is supplied", async () => {
		await expect(sendGift({ userId: 2, itemId: 10 })).resolves.toEqual({
			ok: true,
			data: {},
		});
		expect(mockSendGift).toHaveBeenCalledWith(2, 10, "Here is a gift.");
	});

	it("uses the supplied message", async () => {
		await expect(
			sendGift({ userId: 2, itemId: 10, message: "Happy gift!" }),
		).resolves.toEqual({ ok: true, data: {} });
		expect(mockSendGift).toHaveBeenCalledWith(2, 10, "Happy gift!");
	});
});

describe("setRank", () => {
	it("errors when the target user does not exist", async () => {
		state.target = [];
		await expect(setRank({ userId: 99, rank: 2 })).resolves.toEqual({
			ok: false,
			error: "User not found",
		});
		expect(mockSetRank).not.toHaveBeenCalled();
	});

	it("errors when the requested rank does not exist", async () => {
		state.target = [{ rank: 1 }];
		state.rankRows = [];
		await expect(setRank({ userId: 1, rank: 99 })).resolves.toEqual({
			ok: false,
			error: "Rank does not exist",
		});
	});

	it("errors when the rank lookup query throws", async () => {
		state.target = [{ rank: 1 }];
		state.rankRowsError = new Error("db down");
		await expect(setRank({ userId: 1, rank: 2 })).resolves.toEqual({
			ok: false,
			error: "Rank does not exist",
		});
	});

	it("blocks non-super staff from changing a peer or higher rank", async () => {
		state.target = [{ rank: 7 }];
		state.rankRows = [{ id: 7 }];
		state.isSuperAdmin = false;
		await expect(setRank({ userId: 1, rank: 2 })).resolves.toEqual({
			ok: false,
			error: "Cannot change rank of a user at or above your rank",
		});
	});

	it("blocks non-super staff from granting their own rank or higher", async () => {
		state.target = [{ rank: 1 }];
		state.rankRows = [{ id: 7 }];
		state.isSuperAdmin = false;
		await expect(setRank({ userId: 1, rank: 8 })).resolves.toEqual({
			ok: false,
			error: "Cannot set a rank equal to or above your own",
		});
	});

	it("applies the rank via rcon and the database for a normal staff member", async () => {
		state.target = [{ rank: 1 }];
		state.rankRows = [{ id: 2 }];
		state.isSuperAdmin = false;
		await expect(setRank({ userId: 1, rank: 2 })).resolves.toEqual({
			ok: true,
			data: {},
		});
		expect(mockSetRank).toHaveBeenCalledWith(1, 2);
		expect(state.userUpdates).toHaveLength(1);
		expect(state.userUpdates[0].values).toEqual({ rank: 2 });
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/commandocentrum");
	});

	it("lets a super admin promote freely", async () => {
		state.target = [{ rank: 7 }];
		state.rankRows = [{ id: 10 }];
		state.isSuperAdmin = true;
		await expect(setRank({ userId: 1, rank: 10 })).resolves.toEqual({
			ok: true,
			data: {},
		});
		expect(mockSetRank).toHaveBeenCalledWith(1, 10);
		expect(state.userUpdates).toHaveLength(1);
	});
});

describe("access control", () => {
	it("denies callers without RCON_EXECUTE", async () => {
		state.allowed = false;
		await expect(updateCatalog()).resolves.toEqual({
			ok: false,
			error: "Unauthorized",
		});
		expect(mockUpdateCatalog).not.toHaveBeenCalled();
	});

	it("denies unauthenticated callers", async () => {
		state.authenticated = false;
		const result = await updateCatalog();
		expect(result).toEqual({ ok: false, error: "Unauthorized" });
	});

	it("rejects an rcon failure on setMotto", async () => {
		mockSetMotto.mockResolvedValueOnce(false);
		await expect(setMotto({ userId: 2, motto: "x" })).resolves.toEqual({
			ok: false,
			error: RCON_FAIL,
		});
	});
});

describe("auditing", () => {
	it("logs an entry for a currency grant", async () => {
		const { logAudit } = await import("@/lib/services/audit");
		await giveCredits({ userId: 1, credits: 100 });
		expect(logAudit).toHaveBeenCalledWith(
			expect.objectContaining({ action: expect.any(String) }),
		);
	});

	it("completes the command even when auditing rejects", async () => {
		const { logAudit } = await import("@/lib/services/audit");
		vi.mocked(logAudit).mockRejectedValueOnce(new Error("audit table missing"));
		await expect(giveCredits({ userId: 1, credits: 100 })).resolves.toEqual({
			ok: true,
			data: {},
		});
		// Let the fire-and-forget promise settle; an unhandled rejection here is
		// exactly the failure this guards against.
		await new Promise((r) => setTimeout(r, 0));
	});
});
