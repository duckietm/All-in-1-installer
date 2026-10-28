// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const actionErrorClass = vi.hoisted(
	() =>
		class ActionError extends Error {
			constructor(message: string) {
				super(message);
				this.name = "ActionError";
			}
		},
);

const state = vi.hoisted(() => ({
	allowed: [] as string[],
	tickets: [] as {
		id: number;
		assigneeId: number | null;
		status: string;
		priority: string;
	}[],
	insertCall: undefined as unknown,
	updateCall: undefined as unknown,
	rowsForSelect: [] as unknown[],
	selectTable: undefined as unknown,
}));

vi.mock("@/lib/safe-action", () => ({
	adminAction: (
		opts: { permission?: string | readonly string[]; schema?: z.ZodType },
		handler: (ctx: any) => unknown,
	) => {
		return async (input: unknown) => {
			const needed = Array.isArray(opts.permission)
				? opts.permission
				: [opts.permission ?? ""];
			if (!needed.some((slug) => state.allowed.includes(slug))) {
				return { ok: false, error: "Unauthorized" };
			}
			const ctx: any = {
				session: { user: { id: 100, name: "staff", rank: 10 } },
			};
			if (opts.schema) {
				const parsed = opts.schema.safeParse(input);
				if (!parsed.success) {
					return {
						ok: false,
						error: "Validation failed",
						fieldErrors: z.flattenError(parsed.error).fieldErrors,
					};
				}
				ctx.data = parsed.data;
			} else {
				ctx.data = input;
			}
			try {
				return await handler(ctx);
			} catch (error) {
				if (error instanceof actionErrorClass) {
					return { ok: false, error: error.message };
				}
				throw error;
			}
		};
	},
}));

vi.mock("@/lib/safe-action-shared", () => ({
	ActionError: actionErrorClass,
	actionOk: (data?: unknown) => ({ ok: true, data: data ?? {} }),
}));

vi.mock("@/lib/permissions", () => ({
	PERMS: {
		TICKETS_EDIT: "admin.tickets.edit",
		MOD_TICKETS_EDIT: "mod.tickets.edit",
	},
}));

vi.mock("@/lib/services/audit", () => ({ logAudit: vi.fn() }));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const db = createFakeDb((table, projection) => {
		state.selectTable = table;
		if ("total" in projection) return [{ total: 0 }];
		if (table === schema.WebsiteTicket) return state.tickets;
		return state.rowsForSelect;
	});
	db.insert = vi.fn((table) => ({
		values: (values: unknown) => {
			state.insertCall = { table, values };
			return Promise.resolve([{ insertId: 1n }]);
		},
	}));
	db.update = vi.fn((table) => ({
		set: (values: unknown) => ({
			where: () => {
				state.updateCall = { table, values };
				return Promise.resolve([{ affectedRows: 1 }]);
			},
		}),
	}));
	return { ...schema, db };
});

import { logAudit } from "@/lib/services/audit";
import {
	adminReplyTicket,
	assignTicket,
	updateTicketPriority,
	updateTicketStatus,
} from "./tickets";

beforeEach(() => {
	vi.clearAllMocks();
	state.allowed = ["admin.tickets.edit"];
	state.rowsForSelect = [];
	state.tickets = [];
	state.insertCall = undefined;
	state.updateCall = undefined;
	state.selectTable = undefined;
});

describe("adminReplyTicket", () => {
	it("rejects without the tickets edit permission", async () => {
		state.allowed = [];
		expect(
			await adminReplyTicket({ ticketId: 1, message: "Hello there" }),
		).toEqual({ ok: false, error: "Unauthorized" });
	});

	it("validates the reply payload", async () => {
		const res = await adminReplyTicket({ ticketId: 0, message: "" });
		expect(res).toMatchObject({ ok: false, error: "Validation failed" });
		expect(res.ok ? null : res.fieldErrors?.message).toBeDefined();
	});

	it("throws when the ticket does not exist", async () => {
		state.tickets = [];
		expect(await adminReplyTicket({ ticketId: 5, message: "Hello" })).toEqual({
			ok: false,
			error: "Ticket not found",
		});
	});

	it("inserts a staff message and auto-assigns an unassigned ticket", async () => {
		state.tickets = [
			{ id: 1, assigneeId: null, status: "open", priority: "low" },
		];
		const res = await adminReplyTicket({
			ticketId: 1,
			message: "Working on it",
		});
		expect(res).toEqual({ ok: true, data: {} });
		expect(state.insertCall.values).toMatchObject({
			ticketId: 1,
			userId: 100,
			message: "Working on it",
			isStaff: 1,
		});
		expect(state.updateCall.values).toMatchObject({
			status: "waiting",
			assigneeId: 100,
		});
		expect(logAudit).toHaveBeenCalledWith(
			expect.objectContaining({ action: "ticket_reply", targetId: 1 }),
		);
	});

	it("does not clobber an existing assignee", async () => {
		state.tickets = [
			{ id: 2, assigneeId: 55, status: "open", priority: "low" },
		];
		await adminReplyTicket({ ticketId: 2, message: "Already owned" });
		expect(state.updateCall.values).toMatchObject({ status: "waiting" });
		expect(state.updateCall.values.assigneeId).toBeUndefined();
	});
});

describe("updateTicketStatus", () => {
	it("sets closedAt when closing a ticket", async () => {
		state.tickets = [
			{ id: 3, assigneeId: 55, status: "waiting", priority: "low" },
		];
		const res = await updateTicketStatus({ ticketId: 3, status: "closed" });
		expect(res).toEqual({ ok: true, data: {} });
		expect(state.updateCall.values).toMatchObject({ status: "closed" });
		expect(state.updateCall.values.closedAt).toBeInstanceOf(Date);
		expect(logAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "ticket_status_change",
				before: { status: "waiting" },
				after: { status: "closed" },
			}),
		);
	});

	it("auto-assigns when moving an unowned ticket to in_progress", async () => {
		state.tickets = [
			{ id: 4, assigneeId: null, status: "open", priority: "low" },
		];
		await updateTicketStatus({ ticketId: 4, status: "in_progress" });
		expect(state.updateCall.values).toMatchObject({
			status: "in_progress",
			assigneeId: 100,
		});
	});

	it("does not reassign when already assigned", async () => {
		state.tickets = [{ id: 5, assigneeId: 9, status: "open", priority: "low" }];
		await updateTicketStatus({ ticketId: 5, status: "in_progress" });
		expect(state.updateCall.values.assigneeId).toBeUndefined();
	});

	it("throws when the ticket does not exist", async () => {
		state.tickets = [];
		expect(await updateTicketStatus({ ticketId: 9, status: "open" })).toEqual({
			ok: false,
			error: "Ticket not found",
		});
	});
});

describe("assignTicket", () => {
	it("marks an assigned ticket in_progress", async () => {
		state.tickets = [
			{ id: 6, assigneeId: null, status: "open", priority: "low" },
		];
		const res = await assignTicket({ ticketId: 6, assigneeId: 42 });
		expect(res).toEqual({ ok: true, data: {} });
		expect(state.updateCall.values).toMatchObject({
			assigneeId: 42,
			status: "in_progress",
		});
		expect(logAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "ticket_assign",
				before: { assigneeId: null },
				after: { assigneeId: 42 },
			}),
		);
	});

	it("returns the ticket to open when unassigning", async () => {
		state.tickets = [
			{ id: 7, assigneeId: 42, status: "in_progress", priority: "low" },
		];
		await assignTicket({ ticketId: 7, assigneeId: null });
		expect(state.updateCall.values).toMatchObject({
			assigneeId: null,
			status: "open",
		});
	});

	it("throws when the ticket does not exist", async () => {
		state.tickets = [];
		expect(await assignTicket({ ticketId: 1, assigneeId: 2 })).toEqual({
			ok: false,
			error: "Ticket not found",
		});
	});
});

describe("updateTicketPriority", () => {
	it("updates the priority and audits before/after", async () => {
		state.tickets = [{ id: 8, assigneeId: 5, status: "open", priority: "low" }];
		const res = await updateTicketPriority({ ticketId: 8, priority: "urgent" });
		expect(res).toEqual({ ok: true, data: {} });
		expect(state.updateCall.values).toMatchObject({ priority: "urgent" });
		expect(logAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "ticket_priority_change",
				before: { priority: "low" },
				after: { priority: "urgent" },
			}),
		);
	});

	it("throws when the ticket does not exist", async () => {
		state.tickets = [];
		expect(
			await updateTicketPriority({ ticketId: 1, priority: "high" }),
		).toEqual({
			ok: false,
			error: "Ticket not found",
		});
	});

	it("rejects an unknown priority value", async () => {
		const res = await updateTicketPriority({
			ticketId: 1,
			priority: "max" as never,
		});
		expect(res).toMatchObject({ ok: false, error: "Validation failed" });
	});
});
