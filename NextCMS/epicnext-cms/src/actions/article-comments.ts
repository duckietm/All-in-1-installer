"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { sessionUserId } from "@/lib/auth/session-user";
import { logger } from "@/lib/logger";
import { submitArticleComment } from "@/lib/services/article-comment-submission";

type CommentOutcome =
	| "posted"
	| "empty"
	| "invalid"
	| "moderated"
	| "ratelimit"
	| "not_found"
	| "error";

function commentRedirect(slug: string, outcome: CommentOutcome): never {
	const path = slug ? `/news/${encodeURIComponent(slug)}` : "/news";
	if (outcome === "posted") redirect(`${path}?comment=posted`);
	redirect(`${path}?error=${outcome}`);
}

function isNextRedirect(e: unknown): boolean {
	return (
		!!e &&
		typeof e === "object" &&
		"digest" in e &&
		typeof e.digest === "string" &&
		e.digest.startsWith("NEXT_REDIRECT")
	);
}

/** The signed-in session determines ownership; form-supplied author IDs are ignored. */
export async function postComment(formData: FormData): Promise<void> {
	let slug = String(formData.get("slug") ?? "")
		.normalize("NFC")
		.trim();
	let outcome: CommentOutcome = "error";
	try {
		const session = await auth();
		const userId = sessionUserId(session?.user?.id);
		if (!userId) redirect("/login");
		const result = await submitArticleComment({
			userId,
			target: {
				id: String(formData.get("articleId") ?? "")
					.normalize("NFC")
					.trim(),
			},
			comment: formData.get("comment"),
		});
		if (result.ok) {
			slug = result.slug;
			outcome = "posted";
		} else {
			outcome = result.reason === "too_long" ? "invalid" : result.reason;
		}
	} catch (error) {
		if (isNextRedirect(error)) throw error;
		// Driver errors can include SQL and comment text: retain only safe context.
		logger.error("Article comment submission failed", {
			module: "article-comments",
			channel: "site",
		});
	}

	if (outcome === "posted") {
		try {
			revalidatePath(`/news/${slug}`);
		} catch {
			logger.error("Article comment refresh failed", {
				module: "article-comments",
				channel: "site",
			});
		}
	}
	commentRedirect(slug, outcome);
}
