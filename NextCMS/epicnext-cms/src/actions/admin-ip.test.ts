// @ts-nocheck
import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requirePermission } from "@/lib/admin/guard";
import { fakeForm } from "@/test/fake-form";
import {
	addBlacklist,
	addWhitelist,
	deleteBlacklist,
	deleteWhitelist,
} from "./admin-ip";

const { insertValues, deleteWhere } = vi.hoisted(() => {
	const insertValues = vi.fn().mockResolvedValue([{ insertId: 1 }]);
	const deleteWhere = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
	return { insertValues, deleteWhere };
});

vi.mock("@/lib/admin/guard", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/permissions", () => ({
	PERMS: { SETTINGS_EDIT: "settings.edit" },
}));
vi.mock("@/lib/db", () => ({
	db: {
		insert: vi.fn(() => ({ values: insertValues })),
		delete: vi.fn(() => ({ where: deleteWhere })),
	},
	WebsiteIpWhitelist: { id: "id" },
	WebsiteIpBlacklist: { id: "id" },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const staff = { id: 1, rank: 7, username: "admin" };
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(requirePermission).mockResolvedValue(staff as never);
	insertValues.mockResolvedValue([{ insertId: 1 }]);
	deleteWhere.mockResolvedValue([{ affectedRows: 1 }]);
});

describe("addWhitelist", () => {
	it("creates whitelist entry", async () => {
		await addWhitelist(fakeForm({ ipAddress: "192.168.1.1" }) as FormData);
		expect(insertValues).toHaveBeenCalledWith({
			ipAddress: "192.168.1.1",
			asn: null,
			whitelistAsn: false,
		});
		expect(revalidatePath).toHaveBeenCalledWith("/admin/ip");
	});

	it("returns early when ip is empty", async () => {
		await addWhitelist(fakeForm({ ipAddress: "" }) as FormData);
		expect(insertValues).not.toHaveBeenCalled();
	});
});

describe("deleteWhitelist", () => {
	it("deletes whitelist entry", async () => {
		await deleteWhitelist(fakeForm({ id: "42" }) as FormData);
		expect(deleteWhere).toHaveBeenCalled();
	});
});

describe("addBlacklist", () => {
	it("creates blacklist entry", async () => {
		await addBlacklist(fakeForm({ ipAddress: "203.0.113.1" }) as FormData);
		expect(insertValues).toHaveBeenCalledWith({
			ipAddress: "203.0.113.1",
			asn: null,
			blacklistAsn: false,
		});
	});
});

describe("deleteBlacklist", () => {
	it("deletes blacklist entry", async () => {
		await deleteBlacklist(fakeForm({ id: "99" }) as FormData);
		expect(deleteWhere).toHaveBeenCalled();
	});
});
