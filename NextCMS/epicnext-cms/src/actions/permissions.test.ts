// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	userSelect: [{ total: 0 }] as any[],
	role: [{ id: 10, slug: "rank_1" }] as any[],
	permissions: [{ id: 100 }, { id: 101 }] as any[],
	executeResults: [1, 2, 3] as number[],
	executeIndex: 0,
	inserts: [] as any[],
	upserts: [] as any[],
	updates: [] as any[],
	deletes: 0,
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");

	function makeValues(v: any) {
		state.inserts.push(v);
		const p: any = Promise.resolve([{ insertId: 1 }]);
		p.onDuplicateKeyUpdate = (u: any) => {
			state.upserts.push(u);
			return Promise.resolve([{ affectedRows: 1 }]);
		};
		return p;
	}
	const tx = {
		insert: () => ({ values: makeValues }),
		delete: () => ({
			where: () => {
				state.deletes++;
				return Promise.resolve([{ affectedRows: 1 }]);
			},
		}),
	};
	const fake = createFakeDb((table) => {
		if (table === schema.User) return state.userSelect;
		if (table === schema.AclRole) return state.role;
		if (table === schema.AclPermission) return state.permissions;
		return [];
	});
	return {
		...schema,
		db: {
			...fake,
			insert: () => ({ values: makeValues }),
			update: () => ({
				set: (v: any) => {
					state.updates.push(v);
					return { where: () => Promise.resolve([{ affectedRows: 1 }]) };
				},
			}),
			delete: () => ({
				where: () => {
					state.deletes++;
					return Promise.resolve([{ affectedRows: 1 }]);
				},
			}),
			transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
			execute: () =>
				Promise.resolve([
					{ affectedRows: state.executeResults[state.executeIndex++] ?? 1 },
				]),
		},
	};
});

const perm = vi.hoisted(() => ({ getCtx: vi.fn(), canAccess: vi.fn() }));
vi.mock("@/lib/permissions", async () => ({
	...(await import("@/lib/permission-slugs")),
	getApiAdminContext: perm.getCtx,
	canAccess: perm.canAccess,
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
	rateLimit: vi.fn().mockResolvedValue({ ok: true, retryAfter: 0 }),
	clientIp: vi.fn().mockResolvedValue("127.0.0.1"),
}));
vi.mock("@/lib/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const logStaffActivityMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: logStaffActivityMock,
}));

const ranksMock = vi.hoisted(() => ({
	createEmulatorRank: vi.fn(),
	deleteEmulatorRank: vi.fn(),
	updateEmulatorRank: vi.fn(),
}));
vi.mock("@/lib/services/permission-ranks", () => ranksMock);

const rconMock = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/services/rcon", () => ({ rcon: rconMock }));

const revalidateTagMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidateTag: revalidateTagMock }));

import {
	createRank,
	deleteRank,
	repairAdminNavAclGrants,
	saveRank,
	setCmsPermissions,
} from "./permissions";

const ctx = {
	session: { user: { id: 7, username: "admin", rank: 7, name: "admin" } },
	permissions: { has: () => true },
};

beforeEach(() => {
	vi.clearAllMocks();
	state.userSelect = [{ total: 0 }];
	state.role = [{ id: 10, slug: "rank_1" }];
	state.permissions = [{ id: 100 }, { id: 101 }];
	state.executeResults = [1, 2, 3];
	state.executeIndex = 0;
	state.inserts = [];
	state.upserts = [];
	state.updates = [];
	state.deletes = 0;
	perm.getCtx.mockResolvedValue(ctx);
	perm.canAccess.mockReturnValue(true);
	ranksMock.createEmulatorRank.mockResolvedValue(5);
	ranksMock.deleteEmulatorRank.mockResolvedValue(undefined);
	ranksMock.updateEmulatorRank.mockResolvedValue(undefined);
	rconMock.send.mockResolvedValue(true);
	revalidateTagMock.mockReturnValue(undefined);
	logStaffActivityMock.mockResolvedValue(undefined);
});

describe("createRank", () => {
	it("creates the emulator rank, syncs the CMS role and refreshes RCON", async () => {
		const res = await createRank({ rank_name: "Manager", level: 5 });
		expect(res).toEqual({ ok: true, data: { id: 5 } });
		expect(ranksMock.createEmulatorRank).toHaveBeenCalledWith(
			expect.anything(),
			{
				rank_name: "Manager",
				level: 5,
			},
		);
		expect(state.inserts).toContainEqual({
			slug: "rank_5",
			title: "Manager",
			description: "CMS role synchronized from permission_ranks",
		});
		expect(state.upserts).toContainEqual({ set: { title: "Manager" } });
		expect(logStaffActivityMock).toHaveBeenCalledWith(
			expect.objectContaining({ action: "rank_create", targetId: 5 }),
		);
		expect(rconMock.send).toHaveBeenCalledWith("updatepermissions");
		expect(revalidateTagMock).toHaveBeenCalledWith("permissions", {
			expire: 0,
		});
	});

	it("validates the rank name and level", async () => {
		expect((await createRank({ rank_name: "", level: 1 })).ok).toBe(false);
		expect((await createRank({ rank_name: "x", level: 0 })).ok).toBe(false);
		expect(ranksMock.createEmulatorRank).not.toHaveBeenCalled();
	});

	it("returns Unauthorized without a context", async () => {
		perm.getCtx.mockResolvedValue(null);
		expect(await createRank({ rank_name: "x", level: 1 })).toEqual({
			ok: false,
			error: "Unauthorized",
		});
	});
});

describe("deleteRank", () => {
	it("refuses to delete a rank still assigned to users", async () => {
		state.userSelect = [{ total: 3 }];
		const res = await deleteRank({ id: 1 });
		expect(res).toEqual({
			ok: false,
			error: "Cannot delete: 3 users have this rank",
		});
		expect(ranksMock.deleteEmulatorRank).not.toHaveBeenCalled();
	});

	it("treats a missing count as zero and deletes the rank and role", async () => {
		state.userSelect = [];
		const res = await deleteRank({ id: 1 });
		expect(res).toEqual({ ok: true, data: {} });
		expect(ranksMock.deleteEmulatorRank).toHaveBeenCalledWith(
			expect.anything(),
			1,
		);
		expect(state.deletes).toBe(3);
		expect(logStaffActivityMock).toHaveBeenCalledWith(
			expect.objectContaining({ action: "rank_delete" }),
		);
		expect(rconMock.send).toHaveBeenCalledWith("updatepermissions");
	});

	it("skips ACL cleanup when no CMS role exists", async () => {
		state.role = [];
		const res = await deleteRank({ id: 9 });
		expect(res.ok).toBe(true);
		expect(ranksMock.deleteEmulatorRank).toHaveBeenCalled();
		expect(state.deletes).toBe(0);
	});
});

describe("saveRank", () => {
	it("updates the emulator rank and the CMS role title", async () => {
		const res = await saveRank({ id: 1, fields: { rank_name: "New" } });
		expect(res).toEqual({ ok: true, data: {} });
		expect(ranksMock.updateEmulatorRank).toHaveBeenCalledWith(
			expect.anything(),
			1,
			{ rank_name: "New" },
		);
		expect(state.updates).toContainEqual({ title: "New" });
		expect(logStaffActivityMock).toHaveBeenCalledWith(
			expect.objectContaining({ action: "rank_update" }),
		);
		expect(revalidateTagMock).toHaveBeenCalled();
	});

	it("does not touch the CMS role when rank_name is absent", async () => {
		await saveRank({ id: 1, fields: { level: 2 } });
		expect(state.updates).toHaveLength(0);
		expect(ranksMock.updateEmulatorRank).toHaveBeenCalled();
	});
});

describe("setCmsPermissions", () => {
	it("replaces the role's permission grants inside a transaction", async () => {
		const res = await setCmsPermissions({
			roleId: 10,
			permissionSlugs: ["admin.a", "admin.b"],
		});
		expect(res).toEqual({ ok: true, data: {} });
		expect(state.deletes).toBe(1);
		expect(state.inserts).toContainEqual([
			{ modelId: 10, modelType: "Role", permissionId: 100 },
			{ modelId: 10, modelType: "Role", permissionId: 101 },
		]);
		expect(logStaffActivityMock).toHaveBeenCalledWith(
			expect.objectContaining({
				description: "Updated 2 permissions for rank_1",
			}),
		);
	});

	it("clears grants when no matching permissions are supplied", async () => {
		state.permissions = [];
		const res = await setCmsPermissions({
			roleId: 10,
			permissionSlugs: [],
		});
		expect(res.ok).toBe(true);
		expect(state.deletes).toBe(1);
		expect(state.inserts).toHaveLength(0);
	});

	it("fails when the role does not exist", async () => {
		state.role = [];
		const res = await setCmsPermissions({
			roleId: 99,
			permissionSlugs: ["admin.a"],
		});
		expect(res).toEqual({ ok: false, error: "Role not found" });
	});

	it("rejects more than 500 permission slugs", async () => {
		const res = await setCmsPermissions({
			roleId: 10,
			permissionSlugs: Array.from({ length: 501 }, (_, i) => `p${i}`),
		});
		expect(res.ok).toBe(false);
	});
});

describe("repairAdminNavAclGrants", () => {
	it("reports how many rows the three repair statements inserted", async () => {
		state.executeResults = [2, 3, 5];
		const res = await repairAdminNavAclGrants();
		expect(res).toEqual({ ok: true, data: { inserted: 10 } });
		expect(logStaffActivityMock).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "acl_nav_grants_repair",
				description: expect.stringContaining("10 rows inserted"),
			}),
		);
		expect(revalidateTagMock).toHaveBeenCalledWith("permissions", {
			expire: 0,
		});
	});

	it("coerces missing affectedRows to NaN-safe arithmetic", async () => {
		state.executeResults = [0, 0, 0];
		const res = await repairAdminNavAclGrants();
		expect(res).toEqual({ ok: true, data: { inserted: 0 } });
	});

	it("denies access without the permissions.manage slug", async () => {
		perm.canAccess.mockReturnValue(false);
		const res = await repairAdminNavAclGrants();
		expect(res).toEqual({ ok: false, error: "Unauthorized" });
	});
});
