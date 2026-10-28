"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db, RadioApplications } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// Column bounds from schema (radio_applications):
//   real_name VARCHAR(255); the rest are TEXT. age is an INT.
const NAME_MAX = 255;
const TEXT_MAX = 5000;
const STYLE_MAX = 5000;

type ApplyOutcome = "submitted" | "invalid" | "ratelimit" | "error";

function applyRedirect(outcome: ApplyOutcome): never {
	if (outcome === "submitted") redirect("/radio/apply?submitted=1");
	redirect(`/radio/apply?error=${outcome}`);
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

function str(form: FormData, key: string, max: number): string {
	return String(form.get(key) ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, max);
}

/**
 * Submit a radio DJ application.
 */
export async function applyDj(formData: FormData): Promise<void> {
	let outcome: ApplyOutcome = "error";

	try {
		const session = await auth();
		const userId = Number(session?.user?.id);
		if (!Number.isInteger(userId) || userId <= 0) {
			redirect("/login");
		}

		await clientIp();
		if (!(await rateLimit(`radio-apply:${userId}`, 2, 300_000)).ok) {
			outcome = "ratelimit";
		} else {
			const realName = str(formData, "realName", NAME_MAX);
			const availability = str(formData, "availability", TEXT_MAX);
			const motivation = str(formData, "motivation", TEXT_MAX);
			const experience = str(formData, "experience", TEXT_MAX);
			const musicStyle = str(formData, "musicStyle", STYLE_MAX);

			const ageRaw = Number(formData.get("age"));
			const age = Number.isInteger(ageRaw) ? ageRaw : 0;

			if (!realName || !availability || !motivation || age <= 0) {
				outcome = "invalid";
			} else {
				const now = new Date();
				await db.insert(RadioApplications).values({
					userId: BigInt(userId),
					realName,
					age,
					availability,
					motivation,
					experience: experience || null,
					musicStyle: musicStyle || null,
					status: "pending",
					createdAt: now,
					updatedAt: now,
				});
				outcome = "submitted";
			}
		}
	} catch (e) {
		if (isNextRedirect(e)) throw e;
		outcome = "error";
	}

	revalidatePath("/radio/apply");
	applyRedirect(outcome);
}
