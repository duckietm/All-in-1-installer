"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db, WebsiteUserGuestbooks } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isAllowed } from "@/lib/services/moderation";

// Emulator/CMS column message is VARCHAR(255); keep the write within bounds.
const MESSAGE_MAX = 255;

type GuestbookOutcome =
	| "posted"
	| "empty"
	| "invalid"
	| "moderated"
	| "ratelimit"
	| "error";

function guestbookRedirect(username: string, outcome: GuestbookOutcome): never {
	const path = username ? `/u/${encodeURIComponent(username)}` : "/";
	if (outcome === "posted") redirect(`${path}?guestbook=posted`);
	redirect(`${path}?error=${outcome}`);
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
 * Post a guestbook entry on a profile.
 *
 * The AUTHOR (userId) is re-read from the session via auth() and is never
 * trusted from the submitted FormData, so a crafted form cannot impersonate
 * another account. Only the PROFILE OWNER id (whose guestbook is written) is
 * taken from the form, and we resolve a profile username from the form purely
 * to revalidate / redirect to the right page.
 *
 * Errors redirect back with a machine-readable ?error= code; success redirects
 * with ?guestbook=posted.
 */
export async function postGuestbook(formData: FormData): Promise<void> {
	const username = String(formData.get("username") ?? "")
		.normalize("NFC")
		.trim();

	let outcome: GuestbookOutcome = "error";

	try {
		const session = await auth();
		const userId = Number(session?.user?.id);
		if (!Number.isInteger(userId) || userId <= 0) {
			redirect("/login");
		}

		await clientIp();
		if (!(await rateLimit(`guestbook:${userId}`, 5, 30_000)).ok) {
			outcome = "ratelimit";
		} else {
			const profileId = Number(formData.get("profileId"));
			if (!Number.isInteger(profileId) || profileId <= 0) {
				outcome = "invalid";
			} else {
				const message = String(formData.get("message") ?? "")
					.normalize("NFC")
					.trim()
					.slice(0, MESSAGE_MAX);
				if (!message) {
					outcome = "empty";
				} else if (!(await isAllowed(message)).ok) {
					outcome = "moderated";
				} else {
					const now = new Date();
					await db.insert(WebsiteUserGuestbooks).values({
						profileId,
						userId,
						message,
						createdAt: now,
						updatedAt: now,
					});
					outcome = "posted";
				}
			}
		}
	} catch (e) {
		if (isNextRedirect(e)) throw e;
		outcome = "error";
	}

	if (username) revalidatePath(`/u/${username}`);
	guestbookRedirect(username, outcome);
}
