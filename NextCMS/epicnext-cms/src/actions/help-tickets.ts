"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { positiveBigInt } from "@/lib/api";
import { auth } from "@/lib/auth";
import {
	db,
	WebsiteHelpCenterCategories,
	WebsiteHelpCenterTicketReplies,
	WebsiteHelpCenterTickets,
} from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { moderateOrThrow } from "@/lib/services/moderation";
import { createOwnedTicketReply } from "@/lib/services/ticket-replies";
import { notify } from "@/lib/services/webhook";

const ticketSchema = z.object({
	title: z.string().min(1, "Title is required").max(255),
	content: z.string().min(1, "Content is required").max(5000),
});

type TicketOutcome =
	| "created"
	| "invalid"
	| "moderated"
	| "ratelimit"
	| "error";

type TicketDetailOutcome =
	| "replied"
	| "closed"
	| "invalid"
	| "not_found"
	| "closed_ticket"
	| "moderated"
	| "ratelimit"
	| "error";

function ticketsRedirect(outcome: TicketOutcome): never {
	if (outcome === "created") redirect("/help/tickets?created=1");
	redirect(`/help/tickets?error=${outcome}`);
}

function ticketDetailRedirect(
	ticketId: bigint | null,
	outcome: TicketDetailOutcome,
): never {
	if (!ticketId) redirect("/help/tickets?error=invalid");
	const base = `/help/tickets/${ticketId}`;
	if (outcome === "replied") redirect(`${base}?replied=1`);
	if (outcome === "closed") redirect(`${base}?closed=1`);
	redirect(`${base}?error=${outcome}`);
}

function isNextRedirect(e: unknown): boolean {
	return (
		!!e &&
		typeof e === "object" &&
		"digest" in e &&
		typeof (e as { digest?: unknown }).digest === "string" &&
		(e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
	);
}

export async function createTicket(formData: FormData): Promise<void> {
	let outcome: TicketOutcome = "error";

	try {
		// Re-read the session user id server-side; never trust a form-supplied id.
		const session = await auth();
		const userId = Number(session?.user?.id);
		if (!Number.isInteger(userId) || userId <= 0) {
			redirect("/login");
		}

		await clientIp();
		if (!(await rateLimit(`ticket:${userId}`, 3, 60_000)).ok) {
			outcome = "ratelimit";
		} else {
			const raw = {
				title: String(formData.get("title") ?? "")
					.normalize("NFC")
					.trim()
					.slice(0, 255),
				content: String(formData.get("content") ?? "")
					.normalize("NFC")
					.trim()
					.slice(0, 5000),
			};

			const parsed = ticketSchema.safeParse(raw);
			if (!parsed.success) {
				outcome = "invalid";
			} else {
				const { title, content } = parsed.data;

				let moderated = false;
				try {
					await moderateOrThrow(`${title} ${content}`);
				} catch {
					moderated = true;
					outcome = "moderated";
				}

				if (!moderated) {
					const banAppeal =
						String(formData.get("banAppeal") ?? "") === "1" ||
						String(formData.get("banAppeal") ?? "") === "on";
					let ticketTitle = title;
					let categoryId: bigint | null = null;

					if (banAppeal) {
						if (!/ban\s*appeal/i.test(ticketTitle)) {
							ticketTitle = `[Ban appeal] ${ticketTitle}`.slice(0, 255);
						}
						const [existing] = await db
							.select({ id: WebsiteHelpCenterCategories.id })
							.from(WebsiteHelpCenterCategories)
							.where(eq(WebsiteHelpCenterCategories.name, "Ban appeal"))
							.limit(1);
						if (existing) {
							categoryId = existing.id;
						} else {
							try {
								const [created] = await db
									.insert(WebsiteHelpCenterCategories)
									.values({
										name: "Ban appeal",
										content:
											"Appeals for account bans. Staff can lift bans from the ticket.",
										position: 0,
									});
								categoryId = BigInt(created.insertId);
							} catch {
								const [again] = await db
									.select({ id: WebsiteHelpCenterCategories.id })
									.from(WebsiteHelpCenterCategories)
									.where(eq(WebsiteHelpCenterCategories.name, "Ban appeal"))
									.limit(1);
								categoryId = again?.id ?? null;
							}
						}
					} else {
						const rawCat = String(formData.get("categoryId") ?? "").trim();
						if (/^\d+$/.test(rawCat)) {
							categoryId = BigInt(rawCat);
						}
					}

					const now = new Date();
					await db.insert(WebsiteHelpCenterTickets).values({
						userId,
						title: ticketTitle,
						content,
						categoryId,
						open: true,
						createdAt: now,
						updatedAt: now,
					});
					outcome = "created";

					const sessionUser = session?.user;
					if (sessionUser?.name) {
						notify({
							action: "ticket_create",
							actor: sessionUser.name,
							target: ticketTitle,
						});
					}
				}
			}
		}
	} catch (e) {
		if (isNextRedirect(e)) throw e;
		outcome = "error";
	}

	revalidatePath("/help/tickets");
	ticketsRedirect(outcome);
}

const replyContentSchema = z.object({
	content: z.string().min(1).max(5000),
});

export async function replyHelpTicket(formData: FormData): Promise<void> {
	const ticketId = positiveBigInt(String(formData.get("ticketId") ?? ""));
	let outcome: TicketDetailOutcome = "error";

	try {
		const session = await auth();
		const userId = Number(session?.user?.id);
		if (!Number.isInteger(userId) || userId <= 0) {
			redirect("/login");
		}

		if (!ticketId) {
			outcome = "invalid";
		} else {
			await clientIp();
			if (!(await rateLimit(`ticket-reply:${userId}`, 5, 60_000)).ok) {
				outcome = "ratelimit";
			} else {
				const raw = {
					content: String(formData.get("content") ?? "")
						.normalize("NFC")
						.trim()
						.slice(0, 5000),
				};
				const parsed = replyContentSchema.safeParse(raw);
				if (!parsed.success) {
					outcome = "invalid";
				} else {
					const [ticket] = await db
						.select({
							id: WebsiteHelpCenterTickets.id,
							userId: WebsiteHelpCenterTickets.userId,
							open: WebsiteHelpCenterTickets.open,
						})
						.from(WebsiteHelpCenterTickets)
						.where(eq(WebsiteHelpCenterTickets.id, ticketId))
						.limit(1);

					if (!ticket || ticket.userId !== userId) {
						outcome = "not_found";
					} else if (!ticket.open) {
						outcome = "closed_ticket";
					} else {
						let moderated = false;
						try {
							await moderateOrThrow(parsed.data.content);
						} catch {
							moderated = true;
							outcome = "moderated";
						}

						if (!moderated) {
							const created = await db.transaction(async (tx) =>
								createOwnedTicketReply(
									{
										findTicket: async (id) => {
											const [row] = await tx
												.select({
													id: WebsiteHelpCenterTickets.id,
													userId: WebsiteHelpCenterTickets.userId,
													open: WebsiteHelpCenterTickets.open,
												})
												.from(WebsiteHelpCenterTickets)
												.where(eq(WebsiteHelpCenterTickets.id, id))
												.limit(1);
											return row ?? null;
										},
										createReply: async (data) => {
											const [result] = await tx
												.insert(WebsiteHelpCenterTicketReplies)
												.values(data);
											return {
												id: BigInt(result.insertId),
												userId: data.userId,
												content: data.content,
												createdAt: data.createdAt,
											};
										},
										touchTicket: (id, updatedAt) =>
											tx
												.update(WebsiteHelpCenterTickets)
												.set({ updatedAt })
												.where(eq(WebsiteHelpCenterTickets.id, id)),
									},
									{
										ticketId,
										userId,
										content: parsed.data.content,
									},
								),
							);
							outcome = created ? "replied" : "not_found";
						}
					}
				}
			}
		}
	} catch (e) {
		if (isNextRedirect(e)) throw e;
		outcome = "error";
	}

	if (ticketId) revalidatePath(`/help/tickets/${ticketId}`);
	revalidatePath("/help/tickets");
	ticketDetailRedirect(ticketId, outcome);
}

export async function closeHelpTicket(formData: FormData): Promise<void> {
	const ticketId = positiveBigInt(String(formData.get("ticketId") ?? ""));
	let outcome: TicketDetailOutcome = "error";

	try {
		const session = await auth();
		const userId = Number(session?.user?.id);
		if (!Number.isInteger(userId) || userId <= 0) {
			redirect("/login");
		}

		if (!ticketId) {
			outcome = "invalid";
		} else {
			await clientIp();
			if (!(await rateLimit(`ticket-close:${userId}`, 10, 60_000)).ok) {
				outcome = "ratelimit";
			} else {
				const [ticket] = await db
					.select({
						id: WebsiteHelpCenterTickets.id,
						userId: WebsiteHelpCenterTickets.userId,
						open: WebsiteHelpCenterTickets.open,
					})
					.from(WebsiteHelpCenterTickets)
					.where(eq(WebsiteHelpCenterTickets.id, ticketId))
					.limit(1);

				if (!ticket || ticket.userId !== userId) {
					outcome = "not_found";
				} else if (!ticket.open) {
					outcome = "closed_ticket";
				} else {
					const now = new Date();
					await db
						.update(WebsiteHelpCenterTickets)
						.set({ open: false, updatedAt: now })
						.where(eq(WebsiteHelpCenterTickets.id, ticketId));
					outcome = "closed";
				}
			}
		}
	} catch (e) {
		if (isNextRedirect(e)) throw e;
		outcome = "error";
	}

	if (ticketId) revalidatePath(`/help/tickets/${ticketId}`);
	revalidatePath("/help/tickets");
	ticketDetailRedirect(ticketId, outcome);
}
