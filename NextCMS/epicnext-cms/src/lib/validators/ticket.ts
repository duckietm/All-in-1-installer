import { z } from "zod";

export const TICKET_CATEGORIES = [
	"general",
	"account",
	"technical",
	"report",
	"billing",
	"other",
] as const;
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TICKET_STATUSES = [
	"open",
	"in_progress",
	"waiting",
	"closed",
] as const;

export const createTicketSchema = z.object({
	subject: z.string().min(5, "Subject must be at least 5 characters").max(255),
	message: z
		.string()
		.min(10, "Message must be at least 10 characters")
		.max(5000),
	category: z.enum(TICKET_CATEGORIES),
});

export const replyTicketSchema = z.object({
	ticketId: z.coerce.number().int().positive(),
	message: z.string().min(1, "Message is required").max(5000),
});

export const updateTicketStatusSchema = z.object({
	ticketId: z.coerce.number().int().positive(),
	status: z.enum(TICKET_STATUSES),
});

export const assignTicketSchema = z.object({
	ticketId: z.coerce.number().int().positive(),
	assigneeId: z.coerce.number().int().positive().nullable(),
});

export const updateTicketPrioritySchema = z.object({
	ticketId: z.coerce.number().int().positive(),
	priority: z.enum(TICKET_PRIORITIES),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type ReplyTicketInput = z.infer<typeof replyTicketSchema>;
export type UpdateTicketStatusInput = z.infer<typeof updateTicketStatusSchema>;
export type AssignTicketInput = z.infer<typeof assignTicketSchema>;
export type UpdateTicketPriorityInput = z.infer<
	typeof updateTicketPrioritySchema
>;
