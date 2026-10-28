// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
	NextResponse: { json: vi.fn() },
}));

vi.mock("next-auth", () => ({
	default: vi.fn(() => ({ handlers: {}, auth: vi.fn(), signOut: vi.fn() })),
}));

vi.mock("@/lib/auth", () => ({
	auth: vi.fn(),
	invalidateLoginCache: vi.fn(),
}));

vi.mock("@/lib/auth/password", () => ({
	hashPassword: vi.fn().mockResolvedValue("hashed_pass_123"),
}));

const { insertValues, deleteWhere, updateSet, selectLimit } = vi.hoisted(
	() => ({
		insertValues: vi.fn(),
		deleteWhere: vi.fn(),
		updateSet: vi.fn(),
		selectLimit: vi.fn(),
	}),
);

vi.mock("@/lib/db", () => ({
	db: {
		insert: vi.fn(() => ({
			values: insertValues,
			onDuplicateKeyUpdate: vi.fn().mockResolvedValue([]),
		})),
		update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateSet })) })),
		delete: vi.fn(() => ({ where: deleteWhere })),
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({ limit: selectLimit })),
			})),
		})),
		transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => {
			const mockTx = {
				insert: vi.fn(() => ({
					values: vi.fn().mockResolvedValue([{ insertId: 42n }]),
				})),
			};
			return cb(mockTx);
		}),
	},
	User: { id: "User.id", username: "User.username", rank: "User.rank" },
	Ban: { userId: "Ban.userId" },
	UsersSettings: {},
	UsersCurrency: {},
	UsersBadges: { id: "UsersBadges.id" },
}));

vi.mock("@/lib/permissions", () => ({
	PERMS: {
		USERS_EDIT: "users.edit",
		USERS_BAN: "users.ban",
		USERS_RESET_PASSWORD: "users.reset_password",
	},
	// Staff in the fixtures is rank 7 and the hotel's top rank is 10, so rank
	// guards act as "below-your-own-rank only".
	getHighestRank: vi.fn(() => Promise.resolve(10)),
}));

vi.mock("@/lib/safe-action", () => ({
	adminAction: vi.fn((_o: unknown, f: (...args: unknown[]) => unknown) => f),
}));

vi.mock("@/lib/safe-action-shared", () => ({
	ActionError: class ActionError extends Error {},
	actionOk: vi.fn((res) => ({ ok: true, data: res })),
}));

vi.mock("@/lib/services/audit", () => ({
	logAudit: vi.fn(),
}));

vi.mock("@/lib/auth/session-revocation", () => ({
	revokeUserCredentials: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/services/webhook", () => ({
	notify: vi.fn(),
}));

vi.mock("@/lib/services/rcon", () => ({
	rcon: {
		disconnectUser: vi.fn().mockResolvedValue(true),
		giveBadge: vi.fn().mockResolvedValue(true),
		removeBadge: vi.fn().mockResolvedValue(true),
		alertUser: vi.fn().mockResolvedValue(true),
		muteUser: vi.fn().mockResolvedValue(true),
		unmuteUser: vi.fn().mockResolvedValue(true),
		giveCredits: vi.fn().mockResolvedValue(true),
	},
}));

import { ActionError } from "@/lib/safe-action-shared";
import { logAudit } from "@/lib/services/audit";
import { rcon } from "@/lib/services/rcon";
import {
	alertUser,
	banUser,
	createUser,
	disconnectUser,
	giveBadge,
	muteUser,
	removeBadge,
	resetPassword,
	unbanUser,
	unmuteUser,
} from "./users";

const mockContext = (data: any, rank = 7) => ({
	data,
	session: {
		user: {
			id: 1,
			username: "superadmin",
			rank,
		},
	},
});

beforeEach(() => {
	vi.clearAllMocks();
	selectLimit.mockResolvedValue([
		{ username: "targetuser", rank: 1, mail: "target@example.com" },
	]);
	deleteWhere.mockResolvedValue([{ affectedRows: 1 }]);
	updateSet.mockResolvedValue([{ affectedRows: 1 }]);
	insertValues.mockResolvedValue([{ insertId: 100n }]);
});

describe("createUser action", () => {
	it("creates a user successfully and logs audit", async () => {
		const ctx = mockContext({
			username: "newuser",
			mail: "new@example.com",
			password: "password123",
			rank: 1,
			motto: "Hello world",
		});

		const res = await (createUser as any)(ctx);

		expect(res).toEqual({ ok: true, data: { id: 42, username: "newuser" } });
		expect(logAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "user_create",
				targetId: 42,
			}),
		);
	});

	it("throws error if admin assigns rank equal or higher than their own", async () => {
		const ctx = mockContext(
			{
				username: "moduser",
				mail: "mod@example.com",
				password: "password123",
				rank: 5,
			},
			5, // admin with rank 5 trying to set rank 5
		);

		await expect((createUser as any)(ctx)).rejects.toThrow(ActionError);
	});
});

describe("banUser & unbanUser actions", () => {
	it("bans target user, disconnects via RCON, and logs audit", async () => {
		const ctx = mockContext({
			userId: 10,
			reason: "Rule breaking",
			duration: 24,
			type: "account",
		});

		await (banUser as any)(ctx);

		expect(rcon.disconnectUser).toHaveBeenCalledWith(10);
		expect(logAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "ban",
				targetId: 10,
			}),
		);
	});

	it("unbans target user and logs audit", async () => {
		const ctx = mockContext({ userId: 10 });

		await (unbanUser as any)(ctx);

		expect(logAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "unban",
				targetId: 10,
			}),
		);
	});
});

describe("giveBadge & removeBadge actions", () => {
	it("gives badge if user doesn't have it yet", async () => {
		selectLimit.mockResolvedValueOnce([
			{ username: "targetuser", rank: 1, mail: "target@example.com" },
		]); // guardRank
		selectLimit.mockResolvedValueOnce([]); // existing badge check (none)

		const ctx = mockContext({ userId: 10, badgeCode: "ADM" });
		await (giveBadge as any)(ctx);

		expect(rcon.giveBadge).toHaveBeenCalledWith(10, "ADM");
	});

	it("throws ActionError if user already has the badge", async () => {
		selectLimit.mockResolvedValueOnce([
			{ username: "targetuser", rank: 1, mail: "target@example.com" },
		]); // guardRank
		selectLimit.mockResolvedValueOnce([{ id: 1 }]); // existing badge check (found)

		const ctx = mockContext({ userId: 10, badgeCode: "ADM" });
		await expect((giveBadge as any)(ctx)).rejects.toThrow(
			"Badge already assigned",
		);
	});

	it("removes badge if user has it", async () => {
		selectLimit.mockResolvedValueOnce([
			{ username: "targetuser", rank: 1, mail: "target@example.com" },
		]); // guardRank
		selectLimit.mockResolvedValueOnce([{ id: 99 }]); // existing badge check (found)

		const ctx = mockContext({ userId: 10, badgeCode: "ADM" });
		await (removeBadge as any)(ctx);

		expect(rcon.removeBadge).toHaveBeenCalledWith(10, "ADM");
	});
});

describe("resetPassword action", () => {
	it("resets password, invalidates login cache and logs audit", async () => {
		const ctx = mockContext({ userId: 10 });
		const res = await (resetPassword as any)(ctx);

		expect(res.data).toHaveProperty("newPassword");
		expect(logAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "reset_password",
				targetId: 10,
			}),
		);
	});
});

describe("moderation tools (disconnect, alert, mute, unmute)", () => {
	it("disconnects user via RCON", async () => {
		const ctx = mockContext({ userId: 10 });
		await (disconnectUser as any)(ctx);
		expect(rcon.disconnectUser).toHaveBeenCalledWith(10);
	});

	it("alerts user via RCON", async () => {
		const ctx = mockContext({ userId: 10, message: "Hello user!" });
		await (alertUser as any)(ctx);
		expect(rcon.alertUser).toHaveBeenCalledWith(10, "Hello user!");
	});

	it("mutes user via RCON and logs audit", async () => {
		const ctx = mockContext({ userId: 10, duration: 600 });
		await (muteUser as any)(ctx);
		expect(rcon.muteUser).toHaveBeenCalledWith(10, 600);
		expect(logAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "user_mute",
				targetId: 10,
			}),
		);
	});

	it("unmutes user via RCON and logs audit", async () => {
		const ctx = mockContext({ userId: 10 });
		await (unmuteUser as any)(ctx);
		expect(rcon.unmuteUser).toHaveBeenCalledWith(10);
		expect(logAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "user_unmute",
				targetId: 10,
			}),
		);
	});
});
