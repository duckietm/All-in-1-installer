"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db, WebsiteStaffApplications } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// AtomCMS validates the application body with `min:10`. Mirror that floor and
// cap the write defensively (column is TEXT, but we keep applications sane).
const CONTENT_MIN = 10;
const CONTENT_MAX = 5000;

type ApplyOutcome =
	| "submitted"
	| "empty"
	| "invalid"
	| "duplicate"
	| "ratelimit"
	| "error";

function staffRedirect(outcome: ApplyOutcome): never {
	if (outcome === "submitted") redirect("/apply/staff?submitted=1");
	redirect(`/apply/staff?error=${outcome}`);
}

function teamRedirect(outcome: ApplyOutcome): never {
	if (outcome === "submitted") redirect("/apply/team?submitted=1");
	redirect(`/apply/team?error=${outcome}`);
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
 * Submit a STAFF application for an open position.
 */
export async function applyStaff(formData: FormData): Promise<void> {
	let outcome: ApplyOutcome = "error";

	try {
		const session = await auth();
		const userId = Number(session?.user?.id);
		if (!Number.isInteger(userId) || userId <= 0) {
			redirect("/login");
		}

		await clientIp();
		if (!(await rateLimit(`apply-staff:${userId}`, 3, 60_000)).ok) {
			outcome = "ratelimit";
		} else {
			const rankId = Number(formData.get("rankId"));
			if (!Number.isInteger(rankId) || rankId <= 0) {
				outcome = "invalid";
			} else {
				const content = String(formData.get("content") ?? "")
					.normalize("NFC")
					.trim()
					.slice(0, CONTENT_MAX);
				if (content.length < CONTENT_MIN) {
					outcome = "empty";
				} else {
					const [existing] = await db
						.select({ id: WebsiteStaffApplications.id })
						.from(WebsiteStaffApplications)
						.where(
							and(
								eq(WebsiteStaffApplications.userId, userId),
								eq(WebsiteStaffApplications.rankId, rankId),
							),
						)
						.limit(1);
					if (existing) {
						outcome = "duplicate";
					} else {
						const now = new Date();
						await db.insert(WebsiteStaffApplications).values({
							userId,
							rankId,
							content,
							createdAt: now,
							updatedAt: now,
						});
						outcome = "submitted";
					}
				}
			}
		}
	} catch (e) {
		if (isNextRedirect(e)) throw e;
		outcome = "error";
	}

	revalidatePath("/apply/staff");
	staffRedirect(outcome);
}

/**
 * Submit a TEAM application.
 */
export async function applyTeam(formData: FormData): Promise<void> {
	let outcome: ApplyOutcome = "error";

	try {
		const session = await auth();
		const userId = Number(session?.user?.id);
		if (!Number.isInteger(userId) || userId <= 0) {
			redirect("/login");
		}

		await clientIp();
		if (!(await rateLimit(`apply-team:${userId}`, 3, 60_000)).ok) {
			outcome = "ratelimit";
		} else {
			const rankId = Number(formData.get("teamId"));
			if (!Number.isInteger(rankId) || rankId <= 0) {
				outcome = "invalid";
			} else {
				const content = String(formData.get("content") ?? "")
					.normalize("NFC")
					.trim()
					.slice(0, CONTENT_MAX);
				if (content.length < CONTENT_MIN) {
					outcome = "empty";
				} else {
					const [existing] = await db
						.select({ id: WebsiteStaffApplications.id })
						.from(WebsiteStaffApplications)
						.where(
							and(
								eq(WebsiteStaffApplications.userId, userId),
								eq(WebsiteStaffApplications.rankId, rankId),
							),
						)
						.limit(1);
					if (existing) {
						outcome = "duplicate";
					} else {
						const now = new Date();
						await db.insert(WebsiteStaffApplications).values({
							userId,
							rankId,
							content,
							createdAt: now,
							updatedAt: now,
						});
						outcome = "submitted";
					}
				}
			}
		}
	} catch (e) {
		if (isNextRedirect(e)) throw e;
		outcome = "error";
	}

	revalidatePath("/apply/team");
	teamRedirect(outcome);
}
