export interface TicketReplyRecord {
	id: bigint;
	userId: number;
	content: string;
	createdAt: Date | null;
}

export interface TicketReplyDb {
	findTicket(
		ticketId: bigint,
	): Promise<{ id: bigint; userId: number | null } | null>;
	createReply(data: {
		ticketId: bigint;
		userId: number;
		content: string;
		createdAt: Date;
		updatedAt: Date;
	}): Promise<TicketReplyRecord>;
	touchTicket(ticketId: bigint, updatedAt: Date): Promise<unknown>;
}

export async function createOwnedTicketReply(
	db: TicketReplyDb,
	input: { ticketId: bigint; userId: number; content: string },
): Promise<TicketReplyRecord | null> {
	const ticket = await db.findTicket(input.ticketId);
	if (!ticket || ticket.userId !== input.userId) return null;

	const now = new Date();
	const reply = await db.createReply({
		...input,
		createdAt: now,
		updatedAt: now,
	});
	await db.touchTicket(input.ticketId, now);
	return reply;
}
