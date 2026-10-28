// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	canAccess: vi.fn(() => true),
	getApiAdminContext: vi.fn(),
	logAuthorizationEvent: vi.fn(),
	logAudit: vi.fn(),
	revalidatePath: vi.fn(),
	extractClientIpAsync: vi.fn(async () => "127.0.0.1"),
	rateLimit: vi.fn(async () => ({ ok: true })),
	reportError: vi.fn(),
	selectRows: [] as unknown[],
	updateSet: vi.fn(),
	updateWhere: vi.fn(async () => [{ affectedRows: 1 }]),
	insertValues: vi.fn(async () => [{}]),
	deleteWhere: vi.fn(async () => [{ affectedRows: 2 }]),
}));

vi.mock("@/lib/admin/authorization-events", () => ({
	logAuthorizationEvent: mocks.logAuthorizationEvent,
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({
	PERMS: {
		USERS_BAN: "admin.users.ban",
		TICKETS_EDIT: "admin.tickets.edit",
		MOD_TICKETS_EDIT: "mod.tickets.edit",
	},
	canAccess: mocks.canAccess,
	getApiAdminContext: mocks.getApiAdminContext,
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/report-error", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/foundation/security", () => ({
	extractClientIpAsync: mocks.extractClientIpAsync,
}));
vi.mock("@/lib/services/audit", () => ({ logAudit: mocks.logAudit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb(() => mocks.selectRows);
	return {
		...schema,
		db: {
			...fake,
			update: vi.fn(() => ({ set: mocks.updateSet })),
			delete: vi.fn(() => ({ where: mocks.deleteWhere })),
			transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
				fn({
					insert: vi.fn(() => ({ values: mocks.insertValues })),
					update: vi.fn(() => ({ set: mocks.updateSet })),
				}),
			),
		},
	};
});

import { PERMS } from "@/lib/permissions";
import {
	closeHelpCenterTicket,
	liftBanFromHelpTicket,
	reopenHelpCenterTicket,
	replyHelpCenterTicket,
} from "./admin-help-tickets";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.canAccess.mockReturnValue(true);
	mocks.getApiAdminContext.mockResolvedValue({
		session: { user: { id: 7, rank: 7, name: "staff" } },
		permissions: {},
	});
	mocks.selectRows = [];
	mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
	mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
	mocks.insertValues.mockResolvedValue([{}]);
	mocks.deleteWhere.mockResolvedValue([{ affectedRows: 2 }]);
});

function ticketId(id: string | number | bigint) {
	return { ticketId: id };
}

describe("liftBanFromHelpTicket", () => {
	it("removes bans, reopens state and returns the removed count", async () => {
		mocks.selectRows = [{ id: 5, userId: 3, open: true, title: "Appeal" }];

		const result = await liftBanFromHelpTicket(ticketId("5"));

		expect(result).toEqual({ ok: true, data: { removed: 2, userId: 3 } });
		expect(mocks.logAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 7,
				action: "unban_via_help_ticket",
				target: "User",
				targetId: 3,
				after: { ticketId: "5", removedBans: 2, title: "Appeal" },
			}),
		);
		expect(mocks.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ open: false, updatedAt: expect.any(Date) }),
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/help-tickets");
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/bans");
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/users/show/3");
	});

	it("skips closing an already closed ticket", async () => {
		mocks.selectRows = [{ id: 5, userId: 3, open: false, title: "Appeal" }];

		await liftBanFromHelpTicket(ticketId("5"));

		expect(mocks.updateSet).not.toHaveBeenCalled();
	});

	it("reports a missing ticket", async () => {
		mocks.selectRows = [];

		expect(await liftBanFromHelpTicket(ticketId("5"))).toEqual({
			ok: false,
			error: "Ticket not found",
		});
	});

	it("reports a ticket without a requester", async () => {
		mocks.selectRows = [{ id: 5, userId: null, open: true, title: "x" }];

		expect(await liftBanFromHelpTicket(ticketId("5"))).toEqual({
			ok: false,
			error: "Ticket has no requester to unban",
		});
		expect(mocks.deleteWhere).not.toHaveBeenCalled();
	});

	it("defaults the removed count to zero when the driver omits affectedRows", async () => {
		mocks.selectRows = [{ id: 5, userId: 3, open: true, title: "x" }];
		mocks.deleteWhere.mockResolvedValueOnce([{}]);

		expect(await liftBanFromHelpTicket(ticketId("5"))).toEqual({
			ok: true,
			data: { removed: 0, userId: 3 },
		});
	});

	it("transforms numeric and bigint ticket ids", async () => {
		mocks.selectRows = [{ id: 5, userId: 3, open: true, title: "x" }];

		await liftBanFromHelpTicket(ticketId(5));
		await liftBanFromHelpTicket(ticketId(5n));

		expect(mocks.selectRows).toBeDefined();
	});

	it("rejects unauthenticated callers", async () => {
		mocks.getApiAdminContext.mockResolvedValueOnce(null);

		expect(await liftBanFromHelpTicket(ticketId("5"))).toEqual({
			ok: false,
			error: "Unauthorized",
		});
	});

	it("rejects callers without the ban permission and logs an authorization event", async () => {
		mocks.canAccess.mockReturnValue(false);

		expect(await liftBanFromHelpTicket(ticketId("5"))).toEqual({
			ok: false,
			error: "Unauthorized",
		});
		expect(mocks.logAuthorizationEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "permission.denied",
				userId: 7,
				permission: PERMS.USERS_BAN,
				source: "adminAction",
			}),
		);
	});

	it("rejects malformed input before the handler runs", async () => {
		const result = await liftBanFromHelpTicket({ ticketId: true } as never);

		expect(result.ok).toBe(false);
		expect(result).toMatchObject({ error: "Validation failed" });
		expect(mocks.logAudit).not.toHaveBeenCalled();
	});
});

describe("replyHelpCenterTicket", () => {
	it("inserts a trimmed reply and bumps the ticket inside a transaction", async () => {
		mocks.selectRows = [{ id: 5, open: true }];

		const result = await replyHelpCenterTicket({
			ticketId: "5",
			content: "  thanks  ",
		});

		expect(result).toEqual({ ok: true, data: {} });
		expect(mocks.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				ticketId: 5n,
				userId: 7,
				content: "thanks",
				createdAt: expect.any(Date),
				updatedAt: expect.any(Date),
			}),
		);
		expect(mocks.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ updatedAt: expect.any(Date) }),
		);
		expect(mocks.logAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "help_center_ticket_reply",
				target: "WebsiteHelpCenterTickets",
				targetId: 5,
			}),
		);
	});

	it("allows a moderator permission from the any-of list", async () => {
		mocks.selectRows = [{ id: 5, open: true }];
		mocks.canAccess.mockImplementation(
			(_perms: unknown, slug: string) => slug === PERMS.MOD_TICKETS_EDIT,
		);

		const result = await replyHelpCenterTicket({
			ticketId: "5",
			content: "ok",
		});

		expect(result.ok).toBe(true);
		expect(mocks.canAccess).toHaveBeenCalledWith(
			expect.anything(),
			PERMS.TICKETS_EDIT,
			expect.anything(),
		);
		expect(mocks.canAccess).toHaveBeenCalledWith(
			expect.anything(),
			PERMS.MOD_TICKETS_EDIT,
			expect.anything(),
		);
	});

	it("reports a missing ticket", async () => {
		mocks.selectRows = [];

		expect(
			await replyHelpCenterTicket({ ticketId: "5", content: "hi" }),
		).toEqual({ ok: false, error: "Ticket not found" });
	});

	it("rejects an empty reply", async () => {
		mocks.selectRows = [{ id: 5, open: true }];

		const result = await replyHelpCenterTicket({ ticketId: "5", content: "" });

		expect(result.ok).toBe(false);
		expect(result).toMatchObject({ error: "Validation failed" });
		expect(mocks.insertValues).not.toHaveBeenCalled();
	});

	it("rejects unauthenticated callers", async () => {
		mocks.getApiAdminContext.mockResolvedValueOnce(null);

		expect(
			await replyHelpCenterTicket({ ticketId: "5", content: "hi" }),
		).toEqual({ ok: false, error: "Unauthorized" });
	});
});

describe("closeHelpCenterTicket", () => {
	it("closes an open ticket and records the audit trail", async () => {
		mocks.selectRows = [{ id: 5, open: true }];

		const result = await closeHelpCenterTicket(ticketId("5"));

		expect(result).toEqual({ ok: true, data: {} });
		expect(mocks.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ open: false, updatedAt: expect.any(Date) }),
		);
		expect(mocks.logAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "help_center_ticket_close",
				before: { open: true },
				after: { open: false },
			}),
		);
	});

	it("reports a missing ticket", async () => {
		mocks.selectRows = [];

		expect(await closeHelpCenterTicket(ticketId("5"))).toEqual({
			ok: false,
			error: "Ticket not found",
		});
	});

	it("reports an already closed ticket", async () => {
		mocks.selectRows = [{ id: 5, open: false }];

		expect(await closeHelpCenterTicket(ticketId("5"))).toEqual({
			ok: false,
			error: "Ticket is already closed",
		});
		expect(mocks.updateSet).not.toHaveBeenCalled();
	});
});

describe("reopenHelpCenterTicket", () => {
	it("reopens a closed ticket and records the audit trail", async () => {
		mocks.selectRows = [{ id: 5, open: false }];

		const result = await reopenHelpCenterTicket(ticketId("5"));

		expect(result).toEqual({ ok: true, data: {} });
		expect(mocks.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ open: true, updatedAt: expect.any(Date) }),
		);
		expect(mocks.logAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "help_center_ticket_reopen",
				before: { open: false },
				after: { open: true },
			}),
		);
	});

	it("reports a missing ticket", async () => {
		mocks.selectRows = [];

		expect(await reopenHelpCenterTicket(ticketId("5"))).toEqual({
			ok: false,
			error: "Ticket not found",
		});
	});

	it("reports an already open ticket", async () => {
		mocks.selectRows = [{ id: 5, open: true }];

		expect(await reopenHelpCenterTicket(ticketId("5"))).toEqual({
			ok: false,
			error: "Ticket is already open",
		});
		expect(mocks.updateSet).not.toHaveBeenCalled();
	});

	it("rejects callers without the ticket permission", async () => {
		mocks.canAccess.mockReturnValue(false);

		expect(await reopenHelpCenterTicket(ticketId("5"))).toEqual({
			ok: false,
			error: "Unauthorized",
		});
	});
});
