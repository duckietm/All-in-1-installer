"use server";

import { and, eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
	db,
	Guilds,
	GuildsForumsComments,
	GuildsForumsThreads,
	MessengerFriendrequests,
	MessengerFriendships,
} from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isAllowed } from "@/lib/services/moderation";

// Guild forum subjects are VARCHAR(255); the comment/message body lives in
// guilds_forums_comments.message which is TEXT. Keep the first post's message
// bounded defensively even though the column is large.
const SUBJECT_MAX = 255;
const MESSAGE_MAX = 10000;

type FriendRequestOutcome =
	| "sent"
	| "self"
	| "invalid"
	| "already_friends"
	| "already_pending"
	| "incoming_pending"
	| "ratelimit"
	| "error";

type ThreadOutcome = "posted" | "invalid" | "not_found" | "ratelimit" | "error";

type ReplyOutcome =
	| "replied"
	| "invalid"
	| "not_found"
	| "locked"
	| "ratelimit"
	| "error";

function profileRedirect(
	username: string,
	outcome: FriendRequestOutcome,
): never {
	const path = username ? `/u/${encodeURIComponent(username)}` : "/";
	if (outcome === "sent") redirect(`${path}?friend=sent`);
	redirect(`${path}?error=${outcome}`);
}

function threadRedirect(guildId: number, outcome: ThreadOutcome): never {
	const base =
		Number.isInteger(guildId) && guildId > 0
			? `/guilds/${guildId}/forum`
			: "/guilds";
	if (outcome === "posted") redirect(`${base}?posted=1`);
	redirect(`${base}/new?error=${outcome}`);
}

function threadReplyRedirect(
	guildId: number,
	threadId: number,
	outcome: ReplyOutcome,
): never {
	if (
		!Number.isInteger(guildId) ||
		guildId <= 0 ||
		!Number.isInteger(threadId) ||
		threadId <= 0
	) {
		redirect("/guilds");
	}
	const base = `/guilds/${guildId}/forum/${threadId}`;
	if (outcome === "replied") redirect(`${base}?replied=1`);
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

/**
 * Send a friend request to another user.
 *
 * The REQUESTER (user_from_id) is re-read from the session via auth() and is
 * never trusted from the submitted FormData, so a crafted form cannot send a
 * request "from" someone else. Only the TARGET user id is taken from the form.
 *
 * Writes into messenger_friendrequests (userFromId = requester, userToId =
 * target). The emulator surfaces the pending request in the in-game messenger.
 *
 * Errors redirect back to the profile with a machine-readable ?error= code;
 * success redirects with ?friend=sent. redirect() is called OUTSIDE the
 * try/catch so its control-flow throw is never swallowed.
 */
export async function sendFriendRequest(formData: FormData): Promise<void> {
	const username = String(formData.get("username") ?? "")
		.normalize("NFC")
		.trim();

	let outcome: FriendRequestOutcome = "error";

	try {
		const session = await auth();
		const fromId = Number(session?.user?.id);
		if (!Number.isInteger(fromId) || fromId <= 0) {
			redirect("/login");
		}

		await clientIp();
		if (!(await rateLimit(`friend:${fromId}`, 5, 60_000)).ok) {
			outcome = "ratelimit";
		} else {
			const toId = Number(formData.get("userId"));
			if (!Number.isInteger(toId) || toId <= 0) {
				outcome = "invalid";
			} else if (toId === fromId) {
				outcome = "self";
			} else {
				// Guard against duplicate pending requests and already-existing friendships.
				const [[outgoingRequest], [incomingRequest], [existingFriendship]] =
					await Promise.all([
						db
							.select({ id: MessengerFriendrequests.id })
							.from(MessengerFriendrequests)
							.where(
								and(
									eq(MessengerFriendrequests.userFromId, fromId),
									eq(MessengerFriendrequests.userToId, toId),
								),
							)
							.limit(1),
						db
							.select({ id: MessengerFriendrequests.id })
							.from(MessengerFriendrequests)
							.where(
								and(
									eq(MessengerFriendrequests.userFromId, toId),
									eq(MessengerFriendrequests.userToId, fromId),
								),
							)
							.limit(1),
						db
							.select({ id: MessengerFriendships.id })
							.from(MessengerFriendships)
							.where(
								or(
									and(
										eq(MessengerFriendships.userOneId, fromId),
										eq(MessengerFriendships.userTwoId, toId),
									),
									and(
										eq(MessengerFriendships.userOneId, toId),
										eq(MessengerFriendships.userTwoId, fromId),
									),
								),
							)
							.limit(1),
					]);

				if (existingFriendship) {
					outcome = "already_friends";
				} else if (outgoingRequest) {
					outcome = "already_pending";
				} else if (incomingRequest) {
					// They already asked you — respond from Messages instead of
					// creating a duplicate reverse row.
					outcome = "incoming_pending";
				} else {
					await db.insert(MessengerFriendrequests).values({
						userFromId: fromId,
						userToId: toId,
					});
					outcome = "sent";
				}
			}
		}
	} catch (e) {
		if (isNextRedirect(e)) throw e;
		outcome = "error";
	}

	if (username) revalidatePath(`/u/${username}`);
	revalidatePath("/messages");
	profileRedirect(username, outcome);
}

/**
 * Open a new thread in a guild's forum.
 *
 * The AUTHOR (opener_id) is re-read from the session via auth() and is never
 * trusted from the submitted FormData. Only the guild id, subject, and message
 * come from the form.
 *
 * AtomCMS/Arcturus splits a thread into a header row (guilds_forums_threads)
 * plus the opening post stored as the first comment (guilds_forums_comments).
 * We create both in a transaction so the thread always has its first post, then
 * stamp posts_count = 1 to match the emulator's bookkeeping.
 *
 * Errors redirect back to the new-thread form with ?error=; success redirects
 * to the forum with ?posted=1.
 */
export async function postThread(formData: FormData): Promise<void> {
	const guildId = Number(formData.get("guildId"));
	let outcome: ThreadOutcome = "error";

	try {
		const session = await auth();
		const openerId = Number(session?.user?.id);
		if (!Number.isInteger(openerId) || openerId <= 0) {
			redirect("/login");
		}

		if (!Number.isInteger(guildId) || guildId <= 0) {
			outcome = "invalid";
		} else {
			await clientIp();
			if (!(await rateLimit(`forum:${openerId}`, 3, 60_000)).ok) {
				outcome = "ratelimit";
			} else {
				const subject = String(formData.get("subject") ?? "")
					.normalize("NFC")
					.trim()
					.slice(0, SUBJECT_MAX);
				const message = String(formData.get("message") ?? "")
					.normalize("NFC")
					.trim()
					.slice(0, MESSAGE_MAX);
				if (!subject || !message) {
					outcome = "invalid";
				} else if (!(await isAllowed(`${subject} ${message}`)).ok) {
					outcome = "invalid";
				} else {
					const now = Math.floor(Date.now() / 1000);

					const [guild] = await db
						.select({ id: Guilds.id })
						.from(Guilds)
						.where(eq(Guilds.id, guildId))
						.limit(1);
					if (!guild) {
						outcome = "not_found";
					} else {
						await db.transaction(async (tx) => {
							const [result] = await tx.insert(GuildsForumsThreads).values({
								guildId,
								openerId,
								subject,
								postsCount: 1,
								createdAt: now,
								updatedAt: now,
								state: 0,
								pinned: 0,
								locked: 0,
								adminId: 0,
							});
							const threadId = Number(result.insertId);

							await tx.insert(GuildsForumsComments).values({
								threadId,
								userId: openerId,
								message,
								createdAt: now,
								state: 0,
								adminId: 0,
							});
						});
						outcome = "posted";
					}
				}
			}
		}
	} catch (e) {
		if (isNextRedirect(e)) throw e;
		outcome = "error";
	}

	if (Number.isInteger(guildId) && guildId > 0) {
		revalidatePath(`/guilds/${guildId}/forum`);
	}
	threadRedirect(guildId, outcome);
}

/**
 * Reply to an existing guild forum thread.
 *
 * The AUTHOR (user_id) is re-read from the session via auth() and is never
 * trusted from the submitted FormData. guildId, threadId, and message come
 * from the form.
 *
 * Appends a row to guilds_forums_comments and bumps the thread's posts_count
 * and updated_at to match emulator bookkeeping. Locked threads reject replies.
 */
export async function replyToThread(formData: FormData): Promise<void> {
	const guildId = Number(formData.get("guildId"));
	const threadId = Number(formData.get("threadId"));
	let outcome: ReplyOutcome = "error";

	try {
		const session = await auth();
		const userId = Number(session?.user?.id);
		if (!Number.isInteger(userId) || userId <= 0) {
			redirect("/login");
		}

		if (
			!Number.isInteger(guildId) ||
			guildId <= 0 ||
			!Number.isInteger(threadId) ||
			threadId <= 0
		) {
			outcome = "invalid";
		} else {
			await clientIp();
			if (!(await rateLimit(`forum-reply:${userId}`, 5, 60_000)).ok) {
				outcome = "ratelimit";
			} else {
				const message = String(formData.get("message") ?? "")
					.normalize("NFC")
					.trim()
					.slice(0, MESSAGE_MAX);
				if (!message) {
					outcome = "invalid";
				} else if (!(await isAllowed(message)).ok) {
					outcome = "invalid";
				} else {
					const now = Math.floor(Date.now() / 1000);

					const [thread] = await db
						.select({
							id: GuildsForumsThreads.id,
							locked: GuildsForumsThreads.locked,
							postsCount: GuildsForumsThreads.postsCount,
						})
						.from(GuildsForumsThreads)
						.where(
							and(
								eq(GuildsForumsThreads.id, threadId),
								eq(GuildsForumsThreads.guildId, guildId),
								eq(GuildsForumsThreads.state, 0),
							),
						)
						.limit(1);

					if (!thread) {
						outcome = "not_found";
					} else if (thread.locked) {
						outcome = "locked";
					} else {
						await db.transaction(async (tx) => {
							await tx.insert(GuildsForumsComments).values({
								threadId: thread.id,
								userId,
								message,
								createdAt: now,
								state: 0,
								adminId: 0,
							});

							await tx
								.update(GuildsForumsThreads)
								.set({
									postsCount: (thread.postsCount ?? 0) + 1,
									updatedAt: now,
								})
								.where(eq(GuildsForumsThreads.id, thread.id));
						});
						outcome = "replied";
					}
				}
			}
		}
	} catch (e) {
		if (isNextRedirect(e)) throw e;
		outcome = "error";
	}

	if (
		Number.isInteger(guildId) &&
		guildId > 0 &&
		Number.isInteger(threadId) &&
		threadId > 0
	) {
		revalidatePath(`/guilds/${guildId}/forum`);
		revalidatePath(`/guilds/${guildId}/forum/${threadId}`);
	}
	threadReplyRedirect(guildId, threadId, outcome);
}
