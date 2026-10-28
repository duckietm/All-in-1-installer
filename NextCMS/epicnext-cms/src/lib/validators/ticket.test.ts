import { describe, expect, it } from "vitest";

import {
	assignTicketSchema,
	createTicketSchema,
	replyTicketSchema,
	updateTicketPrioritySchema,
	updateTicketStatusSchema,
} from "./ticket";

describe("createTicketSchema", () => {
	it("accepts valid ticket", () => {
		const result = createTicketSchema.safeParse({
			subject: "Help needed",
			category: "technical",
			message: "I need help with this issue",
		});
		expect(result.success).toBe(true);
	});

	it("rejects short subject (less than 5 chars)", () => {
		expect(
			createTicketSchema.safeParse({
				subject: "Hi",
				category: "technical",
				message: "Help",
			}).success,
		).toBe(false);
	});

	it("rejects short message (less than 10 chars)", () => {
		expect(
			createTicketSchema.safeParse({
				subject: "Subject",
				category: "technical",
				message: "Hi",
			}).success,
		).toBe(false);
	});

	it("rejects missing category", () => {
		expect(
			createTicketSchema.safeParse({
				subject: "Subject",
				message: "Some message",
			}).success,
		).toBe(false);
	});
});

describe("replyTicketSchema", () => {
	it("accepts valid reply", () => {
		const result = replyTicketSchema.safeParse({
			ticketId: 5,
			message: "Update here",
		});
		expect(result.success).toBe(true);
	});

	it("rejects empty message", () => {
		expect(
			replyTicketSchema.safeParse({ ticketId: 5, message: "" }).success,
		).toBe(false);
	});

	it("rejects non-positive ticketId", () => {
		expect(
			replyTicketSchema.safeParse({ ticketId: 0, message: "x" }).success,
		).toBe(false);
	});
});

describe("updateTicketStatusSchema", () => {
	it("accepts valid status change", () => {
		const result = updateTicketStatusSchema.safeParse({
			ticketId: 1,
			status: "closed",
		});
		expect(result.success).toBe(true);
	});

	it("rejects invalid status", () => {
		expect(
			updateTicketStatusSchema.safeParse({ ticketId: 1, status: "unknown" })
				.success,
		).toBe(false);
	});
});

describe("assignTicketSchema", () => {
	it("accepts valid assignment", () => {
		expect(
			assignTicketSchema.safeParse({ ticketId: 1, assigneeId: 5 }).success,
		).toBe(true);
	});

	it("accepts null assignee (unassign)", () => {
		expect(
			assignTicketSchema.safeParse({ ticketId: 1, assigneeId: null }).success,
		).toBe(true);
	});
});

describe("updateTicketPrioritySchema", () => {
	it("accepts valid priority", () => {
		const result = updateTicketPrioritySchema.safeParse({
			ticketId: 1,
			priority: "urgent",
		});
		expect(result.success).toBe(true);
	});
});
