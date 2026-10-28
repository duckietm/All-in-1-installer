// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	tickets: [{ id: 1, state: 0 }] as any[],
	set: null as any,
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb(() => state.tickets);
	return {
		...schema,
		db: {
			...fake,
			update: () => ({
				set: (v: any) => {
					state.set = v;
					return { where: () => Promise.resolve([{ affectedRows: 1 }]) };
				},
			}),
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
vi.mock("@/lib/services/staff-activity", () => ({
	logStaffActivity: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const logAuditMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/audit", () => ({ logAudit: logAuditMock }));

const rconMock = vi.hoisted(() => ({
	disconnectUser: vi.fn(),
	muteUser: vi.fn(),
	unmuteUser: vi.fn(),
	alertUser: vi.fn(),
	kickAll: vi.fn(),
	hotelAlert: vi.fn(),
	staffAlert: vi.fn(),
}));
vi.mock("@/lib/services/rcon", () => ({ rcon: rconMock }));

import {
	assignCfhTicket,
	broadcastAlert,
	closeCfhTicket,
	quickAlert,
	quickKick,
	quickMute,
	quickRoomKick,
	quickUnmute,
	updateCfhState,
} from "./moderation";

const ctx = {
	session: { user: { id: 7, username: "admin", rank: 7, name: "admin" } },
	permissions: { has: () => true },
};

beforeEach(() => {
	vi.clearAllMocks();
	state.tickets = [{ id: 1, state: 0 }];
	state.set = null;
	perm.getCtx.mockResolvedValue(ctx);
	perm.canAccess.mockReturnValue(true);
	for (const fn of Object.values(rconMock)) fn.mockResolvedValue(true);
});

describe("CFH ticket actions", () => {
	it("assigns a ticket to the moderator and audits it", async () => {
		const res = await assignCfhTicket({ ticketId: 1 });
		expect(res).toEqual({ ok: true, data: {} });
		expect(state.set).toEqual({ modId: 7, state: 1 });
		expect(logAuditMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 7,
				action: "cfh_assign",
				targetId: 1,
			}),
		);
	});

	it("returns not-found when assigning a missing ticket", async () => {
		state.tickets = [];
		const res = await assignCfhTicket({ ticketId: 9 });
		expect(res).toEqual({ ok: false, error: "SupportTicket #9 not found" });
		expect(state.set).toBeNull();
	});

	it("updates the ticket state with before/after audit data", async () => {
		const res = await updateCfhState({ ticketId: 1, state: 3 });
		expect(res.ok).toBe(true);
		expect(state.set).toEqual({ state: 3, modId: 7 });
		expect(logAuditMock).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "cfh_state_change",
				before: { state: 0 },
				after: { state: 3 },
			}),
		);
	});

	it("rejects an out-of-range state and a missing ticket", async () => {
		const invalid = await updateCfhState({ ticketId: 1, state: 4 });
		expect(invalid.ok).toBe(false);
		state.tickets = [];
		const missing = await updateCfhState({ ticketId: 1, state: 1 });
		expect(missing).toEqual({
			ok: false,
			error: "SupportTicket #1 not found",
		});
	});

	it("closes a ticket", async () => {
		const res = await closeCfhTicket({ ticketId: 1 });
		expect(res.ok).toBe(true);
		expect(state.set).toEqual({ state: 2, modId: 7 });
		expect(logAuditMock).toHaveBeenCalledWith(
			expect.objectContaining({ action: "cfh_close" }),
		);
	});
});

describe("quick mod actions", () => {
	it("kicks a user via RCON", async () => {
		const res = await quickKick({ userId: 11 });
		expect(res.ok).toBe(true);
		expect(rconMock.disconnectUser).toHaveBeenCalledWith(11);
		expect(logAuditMock).toHaveBeenCalledWith(
			expect.objectContaining({ action: "mod_kick", targetId: 11 }),
		);
	});

	it("mutes a user for a duration", async () => {
		const res = await quickMute({ userId: 11, duration: 600 });
		expect(res.ok).toBe(true);
		expect(rconMock.muteUser).toHaveBeenCalledWith(11, 600);
		expect(logAuditMock).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "mod_mute",
				after: { duration: 600 },
			}),
		);
	});

	it("rejects a mute duration above the one-year maximum", async () => {
		const res = await quickMute({ userId: 11, duration: 525_601 });
		expect(res.ok).toBe(false);
		expect(rconMock.muteUser).not.toHaveBeenCalled();
	});

	it("unmutes a user", async () => {
		await quickUnmute({ userId: 11 });
		expect(rconMock.unmuteUser).toHaveBeenCalledWith(11);
		expect(logAuditMock).toHaveBeenCalledWith(
			expect.objectContaining({ action: "mod_unmute" }),
		);
	});

	it("alerts a user", async () => {
		await quickAlert({ userId: 11, message: "be nice" });
		expect(rconMock.alertUser).toHaveBeenCalledWith(11, "be nice");
	});

	it("rejects an empty alert and a non-positive user id", async () => {
		expect((await quickAlert({ userId: 11, message: "" })).ok).toBe(false);
		expect((await quickKick({ userId: 0 })).ok).toBe(false);
		expect(rconMock.alertUser).not.toHaveBeenCalled();
	});

	it("kicks everyone in a room", async () => {
		await quickRoomKick({ roomId: 3 });
		expect(rconMock.kickAll).toHaveBeenCalledWith(3);
		expect(logAuditMock).toHaveBeenCalledWith(
			expect.objectContaining({ action: "mod_room_kick", targetId: 3 }),
		);
	});

	it("broadcasts a hotel alert", async () => {
		const res = await broadcastAlert({ message: "hi", type: "hotel" });
		expect(res.ok).toBe(true);
		expect(rconMock.hotelAlert).toHaveBeenCalledWith("hi");
		expect(rconMock.staffAlert).not.toHaveBeenCalled();
		expect(logAuditMock).toHaveBeenCalledWith(
			expect.objectContaining({ action: "mod_broadcast_hotel" }),
		);
	});

	it("broadcasts a staff alert", async () => {
		await broadcastAlert({ message: "hi", type: "staff" });
		expect(rconMock.staffAlert).toHaveBeenCalledWith("hi");
		expect(rconMock.hotelAlert).not.toHaveBeenCalled();
	});

	it("rejects an unknown broadcast type", async () => {
		const res = await broadcastAlert({ message: "hi", type: "other" } as never);
		expect(res.ok).toBe(false);
		expect(rconMock.hotelAlert).not.toHaveBeenCalled();
	});
});

describe("authorization", () => {
	it("returns Unauthorized with no admin context", async () => {
		perm.getCtx.mockResolvedValue(null);
		expect(await quickKick({ userId: 1 })).toEqual({
			ok: false,
			error: "Unauthorized",
		});
	});

	it("denies mod actions without the required permission", async () => {
		perm.canAccess.mockReturnValue(false);
		expect(await quickMute({ userId: 1, duration: 1 })).toEqual({
			ok: false,
			error: "Unauthorized",
		});
		expect(rconMock.muteUser).not.toHaveBeenCalled();
	});
});
