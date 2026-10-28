// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirectSafe } from "@/lib/foundation/security";
import { canAccess, getAdminContext } from "@/lib/permissions";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
	requireMod,
	requireModPermission,
	requirePermission,
	requirePermissionRateLimited,
	requireStaff,
	requireStaffRateLimited,
} from "./guard";

vi.mock("@/lib/permissions", () => ({
	getAdminContext: vi.fn(),
	canAccess: vi.fn(),
	PERMS: {
		ADMIN_DASHBOARD: "admin.dashboard",
		MOD_DASHBOARD: "mod.dashboard",
		MODERATION_VIEW: "moderation.view",
		MOD_CFH_VIEW: "mod.cfh.view",
		MOD_ACTIONS: "mod.actions",
		MOD_BANS_VIEW: "mod.bans.view",
		MOD_TICKETS_VIEW: "mod.tickets.view",
		MOD_TEAM_VIEW: "mod.team.view",
		TICKETS_VIEW: "tickets.view",
	},
}));
vi.mock("@/lib/foundation/security", () => ({ redirectSafe: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: vi.fn(), rateLimit: vi.fn() }));

const session = {
	session: { user: { id: 1, rank: 7, username: "admin" } },
	permissions: { "admin.dashboard": 7 },
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getAdminContext).mockResolvedValue(session as never);
	vi.mocked(canAccess).mockImplementation(
		(_p: unknown, _s: string, r: number) => r >= 7,
	);
});

describe("requireStaff", () => {
	it("returns staff when authorized", async () => {
		const s = await requireStaff();
		expect(s).toEqual({ id: 1, rank: 7, username: "admin" });
	});

	it("redirects when unauthorized", async () => {
		vi.mocked(getAdminContext).mockResolvedValue({
			session: { user: { id: 2, rank: 1, username: "user" } },
			permissions: {},
		} as never);
		await requireStaff();
		expect(redirectSafe).toHaveBeenCalledWith("/", "/");
	});
});

describe("requirePermission", () => {
	it("returns staff when both dashboard and specific perm ok", async () => {
		vi.mocked(canAccess).mockReturnValue(true);
		expect(await requirePermission("user.edit")).toEqual({
			id: 1,
			rank: 7,
			username: "admin",
		});
	});
});

describe("requireMod", () => {
	it("allows with MOD_DASHBOARD", async () => {
		vi.mocked(getAdminContext).mockResolvedValue({
			session: { user: { id: 1, rank: 5, username: "mod" } },
			permissions: {},
		} as never);
		vi.mocked(canAccess).mockImplementation(
			(_p: unknown, slug: string) => slug === "mod.dashboard",
		);
		expect(await requireMod()).toEqual({ id: 1, rank: 5, username: "mod" });
	});

	it("redirects without mod perms", async () => {
		vi.mocked(canAccess).mockReturnValue(false);
		await requireMod();
		expect(redirectSafe).toHaveBeenCalledWith("/", "/");
	});
});

describe("requireModPermission", () => {
	it("allows with matching perm", async () => {
		vi.mocked(canAccess).mockImplementation(
			(_p: unknown, slug: string) => slug === "mod.tickets.view",
		);
		await requireModPermission(["mod.bans.view", "mod.tickets.view"]);
		expect(redirectSafe).not.toHaveBeenCalled();
	});
});

describe("requirePermissionRateLimited", () => {
	it("returns staff when rate limit ok", async () => {
		vi.mocked(canAccess).mockReturnValue(true);
		vi.mocked(clientIp).mockResolvedValue("1.2.3.4");
		vi.mocked(rateLimit).mockResolvedValue({ ok: true });
		expect(await requirePermissionRateLimited("x")).toEqual({
			id: 1,
			rank: 7,
			username: "admin",
		});
	});
});

describe("requireStaffRateLimited", () => {
	it("redirects on rate limit", async () => {
		vi.mocked(clientIp).mockResolvedValue("1.2.3.4");
		vi.mocked(rateLimit).mockResolvedValue({ ok: false });
		await requireStaffRateLimited();
		expect(redirectSafe).toHaveBeenCalledWith(
			"/admin?error=ratelimit",
			"/admin",
		);
	});
});
