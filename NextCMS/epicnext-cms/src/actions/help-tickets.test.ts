// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeForm } from "@/test/fake-form";

vi.mock("next/server", () => ({ NextResponse: { json: vi.fn() } }));

const state = vi.hoisted(() => ({
	categories: [] as any[],
	tickets: [] as any[],
	inserts: [] as Array<{ table: unknown; value: any }>,
	updates: [] as any[],
	nextInsertId: 77,
	categoryInsertError: false,
}));

vi.mock("@/lib/db", async () => {
	const schema = await import("@/db/schema");
	const { createFakeDb } = await import("@/test/fake-db");
	const fake = createFakeDb((table) => {
		if (table === schema.WebsiteHelpCenterCategories) return state.categories;
		if (table === schema.WebsiteHelpCenterTickets) return state.tickets;
		return [];
	});
	const makeInsert = (table: unknown) => ({
		values: (value: any) => {
			state.inserts.push({ table, value });
			if (
				table === schema.WebsiteHelpCenterCategories &&
				state.categoryInsertError
			)
				return Promise.reject(new Error("duplicate"));
			return Promise.resolve([{ insertId: state.nextInsertId }]);
		},
	});
	return {
		...schema,
		db: {
			...fake,
			insert: (table: unknown) => makeInsert(table),
			update: (table: unknown) => ({
				set: (value: any) => {
					state.updates.push({ table, value });
					return { where: () => Promise.resolve([{ affectedRows: 1 }]) };
				},
			}),
			transaction: async (cb: (tx: any) => Promise<unknown>) =>
				cb({
					...fake,
					insert: (table: unknown) => makeInsert(table),
					update: (table: unknown) => ({
						set: (value: any) => {
							state.updates.push({ table, value });
							return { where: () => Promise.resolve([{ affectedRows: 1 }]) };
						},
					}),
				}),
		},
	};
});

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: authMock }));

const clientIpMock = vi.hoisted(() => vi.fn());
const rateLimitMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({
	clientIp: clientIpMock,
	rateLimit: rateLimitMock,
}));

const moderateOrThrowMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/moderation", () => ({
	moderateOrThrow: moderateOrThrowMock,
}));

const createOwnedTicketReplyMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/ticket-replies", () => ({
	createOwnedTicketReply: createOwnedTicketReplyMock,
}));

const notifyMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/webhook", () => ({ notify: notifyMock }));

const revalidatePathMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
	redirect: (url: string) => {
		redirectMock(url);
		throw Object.assign(new Error("NEXT_REDIRECT"), {
			digest: `NEXT_REDIRECT;replace;${url};307;`,
		});
	},
}));

import { closeHelpTicket, createTicket, replyHelpTicket } from "./help-tickets";

const redirected = () => redirectMock.mock.calls.at(-1)?.[0];

beforeEach(() => {
	vi.clearAllMocks();
	state.categories = [];
	state.tickets = [];
	state.inserts = [];
	state.updates = [];
	state.nextInsertId = 77;
	state.categoryInsertError = false;
	authMock.mockResolvedValue({ user: { id: 7, name: "bob" } });
	clientIpMock.mockResolvedValue("1.2.3.4");
	rateLimitMock.mockResolvedValue({ ok: true, retryAfter: 0 });
	moderateOrThrowMock.mockResolvedValue(undefined);
	createOwnedTicketReplyMock.mockImplementation(async (ops: any, data: any) => {
		await ops.findTicket(data.ticketId);
		const reply = await ops.createReply({
			ticketId: data.ticketId,
			userId: data.userId,
			content: data.content,
			createdAt: new Date(),
		});
		await ops.touchTicket(data.ticketId, new Date());
		return reply;
	});
	notifyMock.mockResolvedValue(undefined);
});

describe("createTicket", () => {
	it("redirects unauthenticated users to login", async () => {
		authMock.mockResolvedValue(null);
		await expect(
			createTicket(fakeForm({ title: "Help", content: "please" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirectMock).toHaveBeenCalledWith("/login");
	});

	it("reports a rate limit", async () => {
		rateLimitMock.mockResolvedValue({ ok: false, retryAfter: 3 });
		await expect(
			createTicket(fakeForm({ title: "Help", content: "please" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(rateLimitMock).toHaveBeenCalledWith("ticket:7", 3, 60_000);
		expect(redirected()).toBe("/help/tickets?error=ratelimit");
	});

	it("rejects empty title or content", async () => {
		await expect(
			createTicket(fakeForm({ title: " ", content: "please" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirected()).toBe("/help/tickets?error=invalid");
		expect(state.inserts).toHaveLength(0);
	});

	it("rejects a form with missing fields", async () => {
		await expect(createTicket(fakeForm({}))).rejects.toThrow("NEXT_REDIRECT");
		expect(redirected()).toBe("/help/tickets?error=invalid");
	});

	it("blocks moderated content", async () => {
		moderateOrThrowMock.mockRejectedValue(new Error("bad"));
		await expect(
			createTicket(fakeForm({ title: "Help", content: "bad" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirected()).toBe("/help/tickets?error=moderated");
		expect(state.inserts).toHaveLength(0);
	});

	it("creates a ticket with a numeric category and notifies", async () => {
		await expect(
			createTicket(
				fakeForm({
					title: "  My problem  ",
					content: "  details  ",
					categoryId: "5",
				}),
			),
		).rejects.toThrow("NEXT_REDIRECT");

		const ticket = state.inserts.find(
			(i) => i.table && (i.value as any).title === "My problem",
		)?.value;
		expect(ticket).toMatchObject({
			userId: 7,
			content: "details",
			categoryId: 5n,
			open: true,
		});
		expect(notifyMock).toHaveBeenCalledWith(
			expect.objectContaining({ action: "ticket_create", actor: "bob" }),
		);
		expect(revalidatePathMock).toHaveBeenCalledWith("/help/tickets");
		expect(redirected()).toBe("/help/tickets?created=1");
	});

	it("creates a ticket without a valid category and skips notify when unnamed", async () => {
		authMock.mockResolvedValue({ user: { id: 7 } });
		await expect(
			createTicket(
				fakeForm({ title: "Help", content: "please", categoryId: "abc" }),
			),
		).rejects.toThrow("NEXT_REDIRECT");
		const ticket = state.inserts.at(-1)?.value;
		expect(ticket.categoryId).toBeNull();
		expect(notifyMock).not.toHaveBeenCalled();
	});

	it("reuses an existing Ban appeal category and prefixes the title", async () => {
		state.categories = [{ id: 3n }];
		await expect(
			createTicket(
				fakeForm({ title: "unban me", content: "please", banAppeal: "1" }),
			),
		).rejects.toThrow("NEXT_REDIRECT");
		const ticket = state.inserts.at(-1)?.value;
		expect(ticket.title).toBe("[Ban appeal] unban me");
		expect(ticket.categoryId).toBe(3n);
	});

	it("does not double-prefix a title that already mentions ban appeal", async () => {
		state.categories = [{ id: 3n }];
		await expect(
			createTicket(
				fakeForm({
					title: "ban appeal for bob",
					content: "please",
					banAppeal: "on",
				}),
			),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(state.inserts.at(-1)?.value.title).toBe("ban appeal for bob");
	});

	it("creates the Ban appeal category when missing", async () => {
		await expect(
			createTicket(
				fakeForm({ title: "help", content: "please", banAppeal: "1" }),
			),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(state.inserts).toContainEqual(
			expect.objectContaining({
				value: expect.objectContaining({ name: "Ban appeal" }),
			}),
		);
		const ticket = state.inserts.at(-1)?.value;
		expect(ticket.categoryId).toBe(77n);
	});

	it("falls back to a re-read when creating the category races", async () => {
		state.categoryInsertError = true;
		state.categories = [{ id: 9n }];
		await expect(
			createTicket(
				fakeForm({ title: "help", content: "please", banAppeal: "1" }),
			),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(state.inserts.at(-1)?.value.categoryId).toBe(9n);
	});

	it("uses a null category when the raced re-read also finds nothing", async () => {
		state.categoryInsertError = true;
		state.categories = [];
		await expect(
			createTicket(
				fakeForm({ title: "help", content: "please", banAppeal: "1" }),
			),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(state.inserts.at(-1)?.value.categoryId).toBeNull();
	});

	it("maps an unexpected insert failure to ?error=error", async () => {
		const { db } = await import("@/lib/db");
		const original = db.insert;
		(db as any).insert = () => ({
			values: () => Promise.reject(new Error("db down")),
		});
		await expect(
			createTicket(fakeForm({ title: "Help", content: "please" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirected()).toBe("/help/tickets?error=error");
		(db as any).insert = original;
	});
});

describe("replyHelpTicket", () => {
	it("rejects an invalid ticket id before auth work", async () => {
		await expect(
			replyHelpTicket(fakeForm({ ticketId: "0", content: "hi" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirected()).toBe("/help/tickets?error=invalid");
		expect(rateLimitMock).not.toHaveBeenCalled();
	});

	it("rejects a reply form with no ticket id field", async () => {
		await expect(replyHelpTicket(fakeForm({}))).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(redirected()).toBe("/help/tickets?error=invalid");
	});

	it("redirects unauthenticated users to login", async () => {
		authMock.mockResolvedValue(null);
		await expect(
			replyHelpTicket(fakeForm({ ticketId: "1", content: "hi" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirectMock).toHaveBeenCalledWith("/login");
	});

	it("reports a reply rate limit", async () => {
		rateLimitMock.mockResolvedValue({ ok: false, retryAfter: 5 });
		await expect(
			replyHelpTicket(fakeForm({ ticketId: "1", content: "hi" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(rateLimitMock).toHaveBeenCalledWith("ticket-reply:7", 5, 60_000);
		expect(redirected()).toBe("/help/tickets/1?error=ratelimit");
	});

	it("rejects empty content", async () => {
		await expect(
			replyHelpTicket(fakeForm({ ticketId: "1", content: "  " })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirected()).toBe("/help/tickets/1?error=invalid");
	});

	it("rejects a reply form with no content field", async () => {
		await expect(replyHelpTicket(fakeForm({ ticketId: "1" }))).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(redirected()).toBe("/help/tickets/1?error=invalid");
	});

	it("treats a missing ticket at reply time as not_found", async () => {
		state.tickets = [{ id: 1n, userId: 7, open: true }];
		createOwnedTicketReplyMock.mockImplementation(async (ops: any) => {
			state.tickets = [];
			expect(await ops.findTicket(42n)).toBeNull();
			return null;
		});
		await expect(
			replyHelpTicket(fakeForm({ ticketId: "1", content: "hi" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirected()).toBe("/help/tickets/1?error=not_found");
	});

	it("reports a missing or foreign ticket", async () => {
		state.tickets = [];
		await expect(
			replyHelpTicket(fakeForm({ ticketId: "1", content: "hi" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirected()).toBe("/help/tickets/1?error=not_found");

		state.tickets = [{ id: 1n, userId: 999, open: true }];
		await expect(
			replyHelpTicket(fakeForm({ ticketId: "1", content: "hi" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirected()).toBe("/help/tickets/1?error=not_found");
	});

	it("reports a closed ticket", async () => {
		state.tickets = [{ id: 1n, userId: 7, open: false }];
		await expect(
			replyHelpTicket(fakeForm({ ticketId: "1", content: "hi" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirected()).toBe("/help/tickets/1?error=closed_ticket");
	});

	it("blocks moderated replies", async () => {
		state.tickets = [{ id: 1n, userId: 7, open: true }];
		moderateOrThrowMock.mockRejectedValue(new Error("bad"));
		await expect(
			replyHelpTicket(fakeForm({ ticketId: "1", content: "bad" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirected()).toBe("/help/tickets/1?error=moderated");
	});

	it("creates a reply and revalidates the ticket", async () => {
		state.tickets = [{ id: 1n, userId: 7, open: true }];
		await expect(
			replyHelpTicket(fakeForm({ ticketId: "1", content: "  thanks  " })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(createOwnedTicketReplyMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ ticketId: 1n, userId: 7, content: "thanks" }),
		);
		expect(revalidatePathMock).toHaveBeenCalledWith("/help/tickets/1");
		expect(redirected()).toBe("/help/tickets/1?replied=1");
	});

	it("reports not_found when the reply helper refuses ownership", async () => {
		state.tickets = [{ id: 1n, userId: 7, open: true }];
		createOwnedTicketReplyMock.mockResolvedValue(null);
		await expect(
			replyHelpTicket(fakeForm({ ticketId: "1", content: "hi" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirected()).toBe("/help/tickets/1?error=not_found");
	});

	it("maps an unexpected failure to ?error=error", async () => {
		const { db } = await import("@/lib/db");
		vi.spyOn(db, "select").mockImplementationOnce(() => {
			throw new Error("db down");
		});
		await expect(
			replyHelpTicket(fakeForm({ ticketId: "1", content: "hi" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirected()).toBe("/help/tickets/1?error=error");
	});
});

describe("closeHelpTicket", () => {
	it("rejects an invalid ticket id", async () => {
		await expect(
			closeHelpTicket(fakeForm({ ticketId: "abc" })),
		).rejects.toThrow("NEXT_REDIRECT");
		expect(redirected()).toBe("/help/tickets?error=invalid");
	});

	it("rejects a form with no ticket id field", async () => {
		await expect(closeHelpTicket(fakeForm({}))).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(redirected()).toBe("/help/tickets?error=invalid");
	});

	it("redirects unauthenticated users to login", async () => {
		authMock.mockResolvedValue(null);
		await expect(closeHelpTicket(fakeForm({ ticketId: "1" }))).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(redirectMock).toHaveBeenCalledWith("/login");
	});

	it("reports a close rate limit", async () => {
		rateLimitMock.mockResolvedValue({ ok: false, retryAfter: 9 });
		await expect(closeHelpTicket(fakeForm({ ticketId: "1" }))).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(rateLimitMock).toHaveBeenCalledWith("ticket-close:7", 10, 60_000);
		expect(redirected()).toBe("/help/tickets/1?error=ratelimit");
	});

	it("reports a missing or foreign ticket", async () => {
		state.tickets = [];
		await expect(closeHelpTicket(fakeForm({ ticketId: "1" }))).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(redirected()).toBe("/help/tickets/1?error=not_found");
	});

	it("reports an already closed ticket", async () => {
		state.tickets = [{ id: 1n, userId: 7, open: false }];
		await expect(closeHelpTicket(fakeForm({ ticketId: "1" }))).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(redirected()).toBe("/help/tickets/1?error=closed_ticket");
	});

	it("closes an owned open ticket", async () => {
		state.tickets = [{ id: 1n, userId: 7, open: true }];
		await expect(closeHelpTicket(fakeForm({ ticketId: "1" }))).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(state.updates.at(-1)?.value).toMatchObject({
			open: false,
			updatedAt: expect.any(Date),
		});
		expect(redirected()).toBe("/help/tickets/1?closed=1");
	});

	it("maps an unexpected failure to ?error=error", async () => {
		const { db } = await import("@/lib/db");
		vi.spyOn(db, "select").mockImplementationOnce(() => {
			throw new Error("db down");
		});
		await expect(closeHelpTicket(fakeForm({ ticketId: "1" }))).rejects.toThrow(
			"NEXT_REDIRECT",
		);
		expect(redirected()).toBe("/help/tickets/1?error=error");
	});
});
