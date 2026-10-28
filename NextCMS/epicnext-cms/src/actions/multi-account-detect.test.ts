// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	groups: [] as any[],
	users: [] as any[],
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb((_table, projection) =>
		"accountCount" in projection ? state.groups : state.users,
	);
	return { ...schema, db: fake };
});

vi.mock("@/lib/permissions", async () => ({
	...(await import("@/lib/permission-slugs")),
}));

const requirePermissionMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/guard", () => ({
	requirePermission: requirePermissionMock,
}));

import { PERMS } from "@/lib/permissions";
import { detectMultiAccounts } from "./multi-account-detect";

beforeEach(() => {
	vi.clearAllMocks();
	state.groups = [];
	state.users = [];
	requirePermissionMock.mockResolvedValue({ id: 7, rank: 7 });
});

describe("detectMultiAccounts", () => {
	it("checks the users.view permission before querying", async () => {
		await detectMultiAccounts({ minAccounts: 2, limit: 10 });
		expect(requirePermissionMock).toHaveBeenCalledWith(PERMS.USERS_VIEW);
	});

	it("propagates a permission denial", async () => {
		requirePermissionMock.mockRejectedValue(new Error("Denied"));
		await expect(
			detectMultiAccounts({ minAccounts: 2, limit: 10 }),
		).rejects.toThrow("Denied");
	});

	it("returns an empty cluster list when no IPs qualify", async () => {
		const res = await detectMultiAccounts({ minAccounts: 3, limit: 5 });
		expect(res).toEqual({ ok: true, data: { clusters: [] } });
	});

	it("builds one cluster per qualifying IP with its accounts", async () => {
		state.groups = [
			{ ipCurrent: "1.2.3.4", accountCount: 3n },
			{ ipCurrent: "5.6.7.8", accountCount: 2 },
		];
		state.users = [
			{ id: 1, username: "alice", rank: 1, online: "1" },
			{ id: 2, username: "bob", rank: 2, online: "0" },
		];

		const res = await detectMultiAccounts({ minAccounts: 2, limit: 10 });

		expect(res.ok).toBe(true);
		expect(res.data.clusters).toHaveLength(2);
		expect(res.data.clusters[0]).toEqual({
			key: "1.2.3.4",
			label: "IP: 1.2.3.4",
			accountCount: 3,
			accounts: [
				{ id: 1, username: "alice", rank: 1, online: "1" },
				{ id: 2, username: "bob", rank: 2, online: "0" },
			],
		});
		expect(res.data.clusters[1].key).toBe("5.6.7.8");
		expect(res.data.clusters[1].accountCount).toBe(2);
	});
});
