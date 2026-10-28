"use server";

import { and, eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
	db,
	MessengerFriendrequests,
	MessengerFriendships,
	MessengerOffline,
	User,
} from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isAllowed } from "@/lib/services/moderation";

type FriendOutcome =
	| "accepted"
	| "declined"
	| "removed"
	| "not_found"
	| "unauthorized"
	| "invalid"
	| "ratelimit"
	| "error";

type SendOutcome =
	| "sent"
	| "not_friend"
	| "empty"
	| "invalid"
	| "rate_limited"
	| "error";

function messagesRedirect(outcome: FriendOutcome): never {
	if (outcome === "accepted") redirect("/messages?accepted=1");
	if (outcome === "declined") redirect("/messages?declined=1");
	redirect(`/messages?error=${outcome}`);
}

function friendsRedirect(outcome: FriendOutcome): never {
	if (outcome === "removed") redirect("/friends?removed=1");
	redirect(`/friends?error=${outcome}`);
}

function sendRedirect(outcome: SendOutcome): never {
	if (outcome === "sent") redirect("/messages?sent=1");
	redirect(`/messages?send_error=${outcome}`);
}

/**
 * Accept a pending friend request as the SIGNED-IN user.
 *
 * The ACCEPTER is re-read from the session via auth() and is never trusted from
 * the submitted FormData. Only the request id comes from the form, and the
 * request is only honoured when its target (user_to_id) is the session user —
 * so a crafted form cannot accept a request addressed to someone else.
 *
 * Arcturus/AtomCMS stores friendships as TWO directional rows in
 * messenger_friendships (one user_one_id→user_two_id, one the reverse). We
 * create both inside a transaction and delete the originating request so it no
 * longer shows as pending in the in-game messenger or here.
 *
 * Errors redirect back to /messages with a machine-readable ?error= code;
 * success redirects with ?accepted=1. redirect() is called OUTSIDE the
 * try/catch so its control-flow throw is never swallowed.
 */
export async function acceptFriend(formData: FormData): Promise<void> {
	let outcome: FriendOutcome = "error";

	try {
		const session = await auth();
		const meId = Number(session?.user?.id);
		if (!Number.isInteger(meId) || meId <= 0) {
			redirect("/login");
		}

		await clientIp();
		if (!(await rateLimit(`friend-accept:${meId}`, 10, 60_000)).ok) {
			outcome = "ratelimit";
		} else {
			const requestId = Number(formData.get("requestId"));
			if (!Number.isInteger(requestId) || requestId <= 0) {
				outcome = "invalid";
			} else {
				// The request must exist AND be addressed to the session user.
				const [request] = await db
					.select({
						id: MessengerFriendrequests.id,
						userFromId: MessengerFriendrequests.userFromId,
						userToId: MessengerFriendrequests.userToId,
					})
					.from(MessengerFriendrequests)
					.where(eq(MessengerFriendrequests.id, requestId))
					.limit(1);
				if (!request) {
					outcome = "not_found";
				} else if (request.userToId !== meId) {
					outcome = "unauthorized";
				} else {
					const friendId = request.userFromId;
					if (
						!Number.isInteger(friendId) ||
						friendId <= 0 ||
						friendId === meId
					) {
						// Malformed/self request — clear it and treat as not found.
						await db
							.delete(MessengerFriendrequests)
							.where(eq(MessengerFriendrequests.id, requestId));
						outcome = "not_found";
					} else {
						const friendsSince = Math.floor(Date.now() / 1000);

						await db.transaction(async (tx) => {
							// Don't double-insert if a friendship already exists in either direction.
							const [existing] = await tx
								.select({ id: MessengerFriendships.id })
								.from(MessengerFriendships)
								.where(
									or(
										and(
											eq(MessengerFriendships.userOneId, meId),
											eq(MessengerFriendships.userTwoId, friendId),
										),
										and(
											eq(MessengerFriendships.userOneId, friendId),
											eq(MessengerFriendships.userTwoId, meId),
										),
									),
								)
								.limit(1);

							if (!existing) {
								await tx.insert(MessengerFriendships).values([
									{ userOneId: meId, userTwoId: friendId, friendsSince },
									{ userOneId: friendId, userTwoId: meId, friendsSince },
								]);
							}

							// Clear this request and any reverse pending request between the pair.
							await tx
								.delete(MessengerFriendrequests)
								.where(
									or(
										eq(MessengerFriendrequests.id, requestId),
										and(
											eq(MessengerFriendrequests.userFromId, meId),
											eq(MessengerFriendrequests.userToId, friendId),
										),
										and(
											eq(MessengerFriendrequests.userFromId, friendId),
											eq(MessengerFriendrequests.userToId, meId),
										),
									),
								);
						});

						outcome = "accepted";
					}
				}
			}
		}
	} catch (e) {
		// redirect() throws a NEXT_REDIRECT control-flow signal — re-throw it.
		if (
			e &&
			typeof e === "object" &&
			"digest" in e &&
			typeof (e as { digest?: unknown }).digest === "string" &&
			(e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
		) {
			throw e;
		}
		outcome = "error";
	}

	revalidatePath("/messages");
	revalidatePath("/friends");
	messagesRedirect(outcome);
}

/**
 * Decline a pending friend request as the SIGNED-IN user.
 *
 * Only the request's target (user_to_id) may decline. Deletes the
 * messenger_friendrequests row without creating a friendship.
 */
export async function declineFriendRequest(formData: FormData): Promise<void> {
	let outcome: FriendOutcome = "error";

	try {
		const session = await auth();
		const meId = Number(session?.user?.id);
		if (!Number.isInteger(meId) || meId <= 0) {
			redirect("/login");
		}

		await clientIp();
		if (!(await rateLimit(`friend-decline:${meId}`, 10, 60_000)).ok) {
			outcome = "ratelimit";
		} else {
			const requestId = Number(formData.get("requestId"));
			if (!Number.isInteger(requestId) || requestId <= 0) {
				outcome = "invalid";
			} else {
				const [request] = await db
					.select({
						id: MessengerFriendrequests.id,
						userToId: MessengerFriendrequests.userToId,
					})
					.from(MessengerFriendrequests)
					.where(eq(MessengerFriendrequests.id, requestId))
					.limit(1);
				if (!request) {
					outcome = "not_found";
				} else if (request.userToId !== meId) {
					outcome = "unauthorized";
				} else {
					await db
						.delete(MessengerFriendrequests)
						.where(eq(MessengerFriendrequests.id, requestId));
					outcome = "declined";
				}
			}
		}
	} catch (e) {
		if (
			e &&
			typeof e === "object" &&
			"digest" in e &&
			typeof (e as { digest?: unknown }).digest === "string" &&
			(e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
		) {
			throw e;
		}
		outcome = "error";
	}

	revalidatePath("/messages");
	messagesRedirect(outcome);
}

/**
 * Remove an existing friendship between the SIGNED-IN user and another user.
 *
 * Deletes BOTH directional rows in messenger_friendships (Arcturus stores one
 * row each way) and clears any leftover pending requests between the pair.
 * Only the friend id comes from the form; the session user is never trusted
 * from FormData.
 */
export async function removeFriendship(formData: FormData): Promise<void> {
	let outcome: FriendOutcome = "error";

	try {
		const session = await auth();
		const meId = Number(session?.user?.id);
		if (!Number.isInteger(meId) || meId <= 0) {
			redirect("/login");
		}

		await clientIp();
		if (!(await rateLimit(`friend-remove:${meId}`, 10, 60_000)).ok) {
			outcome = "ratelimit";
		} else {
			const friendId = Number(formData.get("friendId"));
			if (!Number.isInteger(friendId) || friendId <= 0 || friendId === meId) {
				outcome = "invalid";
			} else {
				const deleted = await db.transaction(async (tx) => {
					const result = await tx
						.delete(MessengerFriendships)
						.where(
							or(
								and(
									eq(MessengerFriendships.userOneId, meId),
									eq(MessengerFriendships.userTwoId, friendId),
								),
								and(
									eq(MessengerFriendships.userOneId, friendId),
									eq(MessengerFriendships.userTwoId, meId),
								),
							),
						);

					await tx
						.delete(MessengerFriendrequests)
						.where(
							or(
								and(
									eq(MessengerFriendrequests.userFromId, meId),
									eq(MessengerFriendrequests.userToId, friendId),
								),
								and(
									eq(MessengerFriendrequests.userFromId, friendId),
									eq(MessengerFriendrequests.userToId, meId),
								),
							),
						);

					return Number(result[0]?.affectedRows ?? 0);
				});

				outcome = deleted > 0 ? "removed" : "not_found";
			}
		}
	} catch (e) {
		if (
			e &&
			typeof e === "object" &&
			"digest" in e &&
			typeof (e as { digest?: unknown }).digest === "string" &&
			(e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
		) {
			throw e;
		}
		outcome = "error";
	}

	revalidatePath("/friends");
	revalidatePath("/messages");
	friendsRedirect(outcome);
}

/**
 * Send an offline messenger message to a friend (Arcturus messenger_offline row).
 * Only confirmed friendships may receive messages; body is capped at 500 chars.
 */
export async function sendOfflineMessage(formData: FormData): Promise<void> {
	let outcome: SendOutcome = "error";

	try {
		const session = await auth();
		const meId = Number(session?.user?.id);
		if (!Number.isInteger(meId) || meId <= 0) {
			redirect("/login");
		}

		if (!(await rateLimit(`offline-msg:${meId}`, 10, 60_000)).ok) {
			outcome = "rate_limited";
		} else {
			const friendId = Number(formData.get("friendId"));
			const rawMessage = String(formData.get("message") ?? "")
				.normalize("NFC")
				.trim();
			const message = rawMessage.slice(0, 500);

			if (!Number.isInteger(friendId) || friendId <= 0 || friendId === meId) {
				outcome = "invalid";
			} else if (!message) {
				outcome = "empty";
			} else {
				const [friendship] = await db
					.select({ id: MessengerFriendships.id })
					.from(MessengerFriendships)
					.where(
						or(
							and(
								eq(MessengerFriendships.userOneId, meId),
								eq(MessengerFriendships.userTwoId, friendId),
							),
							and(
								eq(MessengerFriendships.userOneId, friendId),
								eq(MessengerFriendships.userTwoId, meId),
							),
						),
					)
					.limit(1);

				if (!friendship) {
					outcome = "not_friend";
				} else {
					const [recipient] = await db
						.select({ id: User.id })
						.from(User)
						.where(eq(User.id, friendId))
						.limit(1);
					if (!recipient) {
						outcome = "invalid";
					} else if (!(await isAllowed(message)).ok) {
						outcome = "invalid";
					} else {
						await db.insert(MessengerOffline).values({
							userId: friendId,
							userFromId: meId,
							message,
							sendedOn: Math.floor(Date.now() / 1000),
						});
						outcome = "sent";
					}
				}
			}
		}
	} catch (e) {
		if (
			e &&
			typeof e === "object" &&
			"digest" in e &&
			typeof (e as { digest?: unknown }).digest === "string" &&
			(e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
		) {
			throw e;
		}
		outcome = "error";
	}

	revalidatePath("/messages");
	sendRedirect(outcome);
}
