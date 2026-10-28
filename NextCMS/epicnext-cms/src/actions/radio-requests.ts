"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db, RadioSongRequests } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const SONG_MAX = 255;
const ARTIST_MAX = 255;

type RequestOutcome = "posted" | "empty" | "invalid" | "ratelimit" | "error";

function requestsRedirect(outcome: RequestOutcome): never {
	if (outcome === "posted") redirect("/radio/requests?posted=1");
	redirect(`/radio/requests?error=${outcome}`);
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

export async function submitRequest(formData: FormData): Promise<void> {
	let outcome: RequestOutcome = "error";

	try {
		const session = await auth();
		const userId = Number(session?.user?.id);
		if (!Number.isInteger(userId) || userId <= 0) {
			redirect("/login");
		}

		await clientIp();
		if (!(await rateLimit(`radio-req:${userId}`, 5, 30_000)).ok) {
			outcome = "ratelimit";
		} else {
			const songTitle = String(formData.get("songTitle") ?? "")
				.normalize("NFC")
				.trim()
				.slice(0, SONG_MAX);
			const artist = String(formData.get("artist") ?? "")
				.normalize("NFC")
				.trim()
				.slice(0, ARTIST_MAX);
			if (!songTitle && !artist) {
				outcome = "empty";
			} else {
				const now = new Date();
				await db.insert(RadioSongRequests).values({
					userId: BigInt(userId),
					songTitle: songTitle || null,
					artist: artist || null,
					submittedAt: now,
					createdAt: now,
					updatedAt: now,
				});
				outcome = "posted";
			}
		}
	} catch (e) {
		if (isNextRedirect(e)) throw e;
		outcome = "error";
	}

	revalidatePath("/radio/requests");
	requestsRedirect(outcome);
}
