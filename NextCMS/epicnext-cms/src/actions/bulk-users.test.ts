// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requirePermission } from "@/lib/admin/guard";
import { rcon } from "@/lib/services/rcon";
import {
	bulkBan,
	bulkGiveBadge,
	bulkGiveCurrency,
	bulkUnban,
} from "./bulk-users";

const {
	deleteWhere,
	insertValues,
	updateWhere,
	selectLimit,
	selectWhereResolved,
	onDuplicateKeyUpdate,
} = vi.hoisted(() => {
	const deleteWhere = vi.fn().mockResolvedValue([{ affectedRows: 3 }]);
	const onDuplicateKeyUpdate = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
	const insertValues = vi.fn(() => ({
		onDuplicateKeyUpdate,
		// biome-ignore lint/suspicious/noThenProperty: Drizzle query thenable mock
		then(resolve, reject) {
			return Promise.resolve([{ insertId: 1 }]).then(resolve, reject);
		},
	}));
	const updateWhere = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
	const selectLimit = vi.fn().mockResolvedValue([]);
	/** Rows returned when a select chain is awaited without `.limit()`. */
	const selectWhereResolved = vi.fn().mockResolvedValue([]);
	return {
		deleteWhere,
		insertValues,
		updateWhere,
		selectLimit,
		selectWhereResolved,
		onDuplicateKeyUpdate,
	};
});

vi.mock("@/lib/admin/guard", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/permissions", () => ({
	PERMS: { USERS_EDIT: "users.edit" },
	// Staff (rank 7) may act on anyone below the hotel's top rank.
	getHighestRank: vi.fn(() => Promise.resolve(10)),
}));
vi.mock("@/lib/db", () => ({
	db: {
		delete: vi.fn(() => ({ where: deleteWhere })),
		insert: vi.fn(() => ({ values: insertValues })),
		update: vi.fn(() => ({
			set: vi.fn(() => ({ where: updateWhere })),
		})),
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: selectLimit,
					// biome-ignore lint/suspicious/noThenProperty: Drizzle query thenable mock
					then(resolve, reject) {
						return selectWhereResolved().then(resolve, reject);
					},
				})),
			})),
		})),
		transaction: vi.fn(),
	},
	Ban: { userId: "userId", id: "id" },
	User: {
		id: "id",
		credits: "credits",
		username: "username",
		online: "online",
	},
	UsersCurrency: { userId: "userId", type: "type", amount: "amount" },
	UsersBadges: {
		id: "id",
		userId: "userId",
		badgeCode: "badgeCode",
		slotId: "slotId",
	},
	Sanctions: { id: "id", habboId: "habboId" },
	UsersSettings: {
		userId: "userId",
		canTrade: "canTrade",
		tradelockAmount: "tradelockAmount",
	},
}));
vi.mock("@/lib/services/rcon", () => ({
	rcon: {
		giveCredits: vi.fn(),
		giveDuckets: vi.fn(),
		givePointsGotw: vi.fn(),
		giveBadge: vi.fn(),
	},
}));
vi.mock("@/lib/services/staff-activity", () => ({ logStaffActivity: vi.fn() }));

const staff = { id: 1, rank: 7, username: "admin" };

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(requirePermission).mockResolvedValue(staff as never);
	deleteWhere.mockResolvedValue([{ affectedRows: 3 }]);
	insertValues.mockImplementation(() => ({
		onDuplicateKeyUpdate,
		// biome-ignore lint/suspicious/noThenProperty: Drizzle query thenable mock
		then(resolve, reject) {
			return Promise.resolve([{ insertId: 1 }]).then(resolve, reject);
		},
	}));
	onDuplicateKeyUpdate.mockResolvedValue([{ affectedRows: 1 }]);
	updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
	selectLimit.mockResolvedValue([]);
	// Rank rows for the per-id rank guard: every target sits below staff rank 7.
	selectWhereResolved.mockResolvedValue([{ rank: 1 }]);
	// Max slot of existing badges (consumed by the badge loop, not the guard).
	selectWhereResolved.mockResolvedValueOnce([{ rank: 1 }]);
});

describe("bulkUnban", () => {
	it("unbans users", async () => {
		const r = await bulkUnban({ userIds: [1, 2, 3] });
		expect(r.ok).toBe(true);
		expect(r.data).toEqual({ unbanned: 3, total: 3 });
	});
});

describe("bulkBan", () => {
	it("bans users", async () => {
		const r = await bulkBan({
			userIds: [1, 2],
			reason: "Spam",
			duration: 3600,
		});
		expect(r.ok).toBe(true);
		expect(r.data.banned).toBe(2);
		expect(insertValues).toHaveBeenCalledTimes(2);
	});
});

describe("bulkGiveCurrency", () => {
	it("gives credits", async () => {
		const r = await bulkGiveCurrency({
			userIds: [1],
			amount: 100,
			type: "credits",
		});
		expect(r.data.given).toBe(1);
		expect(rcon.giveCredits).toHaveBeenCalledWith(1, 100);
		expect(updateWhere).toHaveBeenCalled();
	});

	it("gives pixels", async () => {
		const r = await bulkGiveCurrency({
			userIds: [2],
			amount: 50,
			type: "pixels",
		});
		expect(r.data.given).toBe(1);
		expect(rcon.giveDuckets).toHaveBeenCalledWith(2, 50);
		expect(onDuplicateKeyUpdate).toHaveBeenCalled();
	});

	it("gives points", async () => {
		const r = await bulkGiveCurrency({
			userIds: [3],
			amount: 25,
			type: "points",
		});
		expect(r.data.given).toBe(1);
		expect(rcon.givePointsGotw).toHaveBeenCalledWith(3, 25);
		expect(onDuplicateKeyUpdate).toHaveBeenCalled();
	});
});

describe("bulkGiveBadge", () => {
	it("gives badge to user", async () => {
		selectLimit.mockResolvedValueOnce([]);
		selectWhereResolved.mockResolvedValueOnce([{ maxSlot: 5 }]);
		const r = await bulkGiveBadge({ userIds: [1], badgeCode: "ADM" });
		expect(r.data.given).toBe(1);
		expect(insertValues).toHaveBeenCalled();
		expect(rcon.giveBadge).toHaveBeenCalledWith(1, "ADM");
	});
});
