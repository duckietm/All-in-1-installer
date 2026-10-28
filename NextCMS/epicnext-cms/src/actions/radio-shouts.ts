"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db, RadioShouts } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { moderateOrThrow } from "@/lib/services/moderation";

const shoutSchema = z.object({
	message: z.string().min(1, "Message is required").max(255),
});

type ShoutOutcome = "posted" | "invalid" | "moderated" | "ratelimit" | "error";

function shoutsRedirect(outcome: ShoutOutcome): never {
	if (outcome === "posted") redirect("/radio/shouts?posted=1");
	redirect(`/radio/shouts?error=${outcome}`);
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
 * Post a radio shout.
 *
 * The AUTHOR (userId) is re-read from the session via auth() and is never
 * trusted from the submitted FormData, so a crafted form cannot impersonate
 * another account. radio_shouts.user_id is an UNSIGNED BIGINT, so the Int
 * session id is widened to BigInt for the insert.
 *
 * Errors redirect back with a machine-readable ?error= code; success redirects
 * with ?posted=1.
 */
export async function postShout(formData: FormData): Promise<void> {
	let outcome: ShoutOutcome = "error";

	try {
		const session = await auth();
		const userId = Number(session?.user?.id);
		if (!Number.isInteger(userId) || userId <= 0) {
			redirect("/login");
		}

		await clientIp();
		if (!(await rateLimit(`shout:${userId}`, 5, 30_000)).ok) {
			outcome = "ratelimit";
		} else {
			const raw = {
				message: String(formData.get("message") ?? "")
					.normalize("NFC")
					.trim()
					.slice(0, 255),
			};

			const parsed = shoutSchema.safeParse(raw);
			if (!parsed.success) {
				outcome = "invalid";
			} else {
				const { message } = parsed.data;

				let moderated = false;
				try {
					await moderateOrThrow(message);
				} catch {
					moderated = true;
					outcome = "moderated";
				}

				if (!moderated) {
					const now = new Date();
					await db.insert(RadioShouts).values({
						userId: BigInt(userId),
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

	revalidatePath("/radio/shouts");
	shoutsRedirect(outcome);
}
