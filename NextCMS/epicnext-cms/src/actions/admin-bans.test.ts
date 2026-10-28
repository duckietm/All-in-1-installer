// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/server, next-auth and @/lib/auth before imports
vi.mock("next/server", () => ({
	NextResponse: {
		json: vi.fn(),
	},
}));

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

import { Ban, db } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { createBan, liftBan } from "./admin-bans";

// Mock eq from drizzle-orm
const mockEq = vi.hoisted(() => vi.fn());
vi.mock("drizzle-orm", async (importOriginal) => {
	const original = await importOriginal<typeof import("drizzle-orm")>();
	return {
		...original,
		eq: mockEq,
	};
});

// Mock external services
const mockRequirePermissionRateLimited = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/guard", () => ({
	requirePermissionRateLimited: mockRequirePermissionRateLimited,
}));

const mockTryGuardRank = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/rank-guard", () => ({
	tryGuardRank: mockTryGuardRank,
}));

const mockRedirect = vi.hoisted(() =>
	vi.fn(() => {
		throw new Error("NEXT_REDIRECT");
	}),
);
vi.mock("next/navigation", () => ({
	redirect: mockRedirect,
}));

// Hoisted mocks for internal db functions
const hoistedInsertValues = vi.hoisted(() => vi.fn());
const hoistedDeleteWhere = vi.hoisted(() => vi.fn());
const hoistedSelectLimit = vi.hoisted(() => vi.fn());
const hoistedSelectWhere = vi.hoisted(() =>
	vi.fn(() => ({ limit: hoistedSelectLimit })),
);
const hoistedSelectFrom = vi.hoisted(() =>
	vi.fn(() => ({ where: hoistedSelectWhere })),
);

vi.mock("@/lib/db", () => {
	return {
		db: {
			insert: vi.fn(() => ({ values: hoistedInsertValues })),
			delete: vi.fn(() => ({ where: hoistedDeleteWhere })),
			select: vi.fn(() => ({ from: hoistedSelectFrom })),
		},
		Ban: { id: "Ban.id", userId: "Ban.userId" },
	};
});

const mockRconDisconnectUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/rcon", () => ({
	rcon: {
		disconnectUser: mockRconDisconnectUser,
	},
}));

const mockLogStaffActivity = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: mockLogStaffActivity,
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
	revalidatePath: mockRevalidatePath,
	unstable_cache: (fn: any) => fn,
}));

const mockHeaders = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({
	headers: mockHeaders,
}));

beforeEach(() => {
	vi.clearAllMocks();
	mockRequirePermissionRateLimited.mockResolvedValue({ id: 100, rank: 7 });
	hoistedInsertValues.mockResolvedValue([{ insertId: 1 }]);
	hoistedDeleteWhere.mockResolvedValue([{ affectedRows: 1 }]);
	hoistedSelectLimit.mockResolvedValue([{ userId: 5 }]);
	mockTryGuardRank.mockResolvedValue({
		ok: true,
		target: { username: "testuser", rank: 1, mail: null },
	});
	mockHeaders.mockReturnValue(new Map());
});

describe("createBan", () => {
	it("requires USERS_BAN permission and logs activity", async () => {
		const formData = new FormData();
		formData.append("userId", "1");
		formData.append("reason", "Test ban");
		formData.append("hours", "24");
		formData.append("type", "account");

		await createBan(formData);

		expect(mockRequirePermissionRateLimited).toHaveBeenCalledWith(
			PERMS.USERS_BAN,
		);
		expect(mockTryGuardRank).toHaveBeenCalledWith(1, 7);
		expect(db.insert).toHaveBeenCalledWith(Ban);
		expect(hoistedInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 1,
				banReason: "Test ban",
				banExpire: expect.any(Number),
				type: "account",
			}),
		);
		expect(mockLogStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "user_ban",
				targetId: 1,
				description: expect.stringContaining("Banned user #1"),
			}),
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/bans");
	});

	it("sets permanent ban (expire 0) if hours is 0", async () => {
		const formData = new FormData();
		formData.append("userId", "2");
		formData.append("reason", "Permanent ban");
		formData.append("hours", "0");
		formData.append("type", "ip");

		await createBan(formData);

		expect(hoistedInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 2,
				banExpire: 0,
				type: "ip",
			}),
		);
	});

	it("aborts when userId is invalid or zero", async () => {
		const formData = new FormData();
		formData.append("userId", "0");
		formData.append("reason", "Invalid user");
		formData.append("hours", "1");
		formData.append("type", "account");

		await createBan(formData);

		expect(mockTryGuardRank).not.toHaveBeenCalled();
		expect(db.insert).not.toHaveBeenCalled();
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
	});

	it("aborts when ban type is unsupported", async () => {
		const formData = new FormData();
		formData.append("userId", "10");
		formData.append("reason", "Invalid type");
		formData.append("hours", "1");
		formData.append("type", "invalid_type");

		await createBan(formData);

		expect(mockTryGuardRank).not.toHaveBeenCalled();
		expect(db.insert).not.toHaveBeenCalled();
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
	});

	it("disconnects user via RCON using the guarded username", async () => {
		mockTryGuardRank.mockResolvedValueOnce({
			ok: true,
			target: { username: "anotheruser", rank: 1, mail: null },
		});
		const formData = new FormData();
		formData.append("userId", "3");
		formData.append("type", "account");
		formData.append("reason", "Test reason");

		await createBan(formData);

		expect(mockTryGuardRank).toHaveBeenCalledWith(3, 7);
		expect(mockRconDisconnectUser).toHaveBeenCalledWith(3, "anotheruser");
	});

	it("refuses to ban a user with equal or higher rank", async () => {
		mockTryGuardRank.mockResolvedValueOnce({ ok: false, reason: "rank" });
		const formData = new FormData();
		formData.append("userId", "3");
		formData.append("type", "account");
		formData.append("reason", "Test reason");

		await expect(createBan(formData)).rejects.toThrow("NEXT_REDIRECT");

		expect(mockRedirect).toHaveBeenCalledWith("/admin/bans?error=rank");
		expect(db.insert).not.toHaveBeenCalled();
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
	});
});

describe("liftBan", () => {
	it("lifts an existing ban and logs activity", async () => {
		hoistedSelectLimit.mockResolvedValueOnce([{ userId: 5 }]);
		const formData = new FormData();
		formData.append("id", "123");

		await liftBan(formData);

		expect(mockRequirePermissionRateLimited).toHaveBeenCalledWith(
			PERMS.USERS_BAN,
		);
		expect(mockEq).toHaveBeenCalledWith(Ban.id, 123);
		expect(mockTryGuardRank).toHaveBeenCalledWith(5, 7);
		expect(db.delete).toHaveBeenCalledWith(Ban);
		expect(hoistedDeleteWhere).toHaveBeenCalledWith(mockEq(Ban.id, 123));
		expect(mockLogStaffActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "ban_lift",
				description: "Lifted ban #123",
			}),
		);
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/bans");
	});

	it("refuses to lift a ban placed on an equal or higher rank user", async () => {
		hoistedSelectLimit.mockResolvedValueOnce([{ userId: 5 }]);
		mockTryGuardRank.mockResolvedValueOnce({ ok: false, reason: "rank" });
		const formData = new FormData();
		formData.append("id", "123");

		await expect(liftBan(formData)).rejects.toThrow("NEXT_REDIRECT");

		expect(mockRedirect).toHaveBeenCalledWith("/admin/bans?error=rank");
		expect(hoistedDeleteWhere).not.toHaveBeenCalled();
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
	});

	it("tolerates a lift when the targeted user no longer exists", async () => {
		hoistedSelectLimit.mockResolvedValueOnce([{ userId: 5 }]);
		mockTryGuardRank.mockResolvedValueOnce({ ok: false, reason: "not_found" });
		const formData = new FormData();
		formData.append("id", "123");

		await liftBan(formData);

		expect(db.delete).toHaveBeenCalledWith(Ban);
	});

	it("does not delete if ban id is not positive", async () => {
		const formData = new FormData();
		formData.append("id", "0");

		await liftBan(formData);

		expect(mockEq).not.toHaveBeenCalled();
		expect(db.delete).not.toHaveBeenCalled();
		expect(hoistedDeleteWhere).not.toHaveBeenCalled();
		expect(mockLogStaffActivity).not.toHaveBeenCalled();
		expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/bans");
	});
});
