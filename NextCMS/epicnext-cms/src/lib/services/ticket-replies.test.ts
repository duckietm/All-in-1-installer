// @ts-nocheck
import { describe, expect, it } from "vitest";
import { createOwnedTicketReply } from "@/lib/services/ticket-replies";

describe("createOwnedTicketReply", () => {
	it("does not create a reply for a ticket owned by another user", async () => {
		let created = false;
		const db = {
			findTicket: async () => ({ id: 5n, userId: 7 }),
			createReply: async () => {
				created = true;
				throw new Error("must not run");
			},
			touchTicket: async () => undefined,
		};

		await expect(
			createOwnedTicketReply(db, { ticketId: 5n, userId: 99, content: "Help" }),
		).resolves.toBeNull();
		expect(created).toBe(false);
	});

	it("creates the reply and updates ticket activity as one operation", async () => {
		let touchedAt: Date | undefined;
		const db = {
			findTicket: async () => ({ id: 5n, userId: 99 }),
			createReply: async (data: { createdAt: Date }) => ({
				id: 8n,
				userId: 99,
				content: "Help",
				createdAt: data.createdAt,
			}),
			touchTicket: async (_ticketId: bigint, updatedAt: Date) => {
				touchedAt = updatedAt;
			},
		};

		const reply = await createOwnedTicketReply(db, {
			ticketId: 5n,
			userId: 99,
			content: "Help",
		});

		expect(reply).toMatchObject({ id: 8n, userId: 99, content: "Help" });
		expect(touchedAt).toBe(reply?.createdAt);
	});
});
