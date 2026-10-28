// Public REST API: comments belong to the authenticated Bearer token's user.
import { apiError, apiJson, apiUnavailable } from "@/lib/api";
import { bearerUserId } from "@/lib/api-auth";
import { logger } from "@/lib/logger";
import { submitArticleComment } from "@/lib/services/article-comment-submission";

export async function POST(
	req: Request,
	{ params }: { params: Promise<{ slug: string }> },
) {
	try {
		const uid = await bearerUserId(req, ["articles:write"]);
		if (!uid) return apiError("Unauthorized", 401);
		const { slug } = await params;
		const body: unknown = await req.json().catch(() => null);
		const result = await submitArticleComment({
			userId: uid,
			target: { slug },
			comment:
				body && typeof body === "object" && "comment" in body
					? body.comment
					: undefined,
		});
		if (result.ok) return apiJson({ ok: true });
		switch (result.reason) {
			case "ratelimit": {
				const response = apiError(
					"Too many comments. Please wait a minute.",
					429,
				);
				response.headers.set("Retry-After", String(result.retryAfter ?? 30));
				return response;
			}
			case "empty":
				return apiError("Comment is required", 422);
			case "too_long":
				return apiError("Comment may not be longer than 255 characters", 422);
			case "moderated":
				return apiError("Comment was blocked by moderation", 422);
			case "invalid":
			case "not_found":
				return apiError("Article not found", 404);
		}
	} catch {
		// Driver errors may contain SQL and user content; log a safe diagnostic.
		logger.error("Article comment submission failed", {
			module: "article-comments",
			channel: "api",
		});
		return apiUnavailable("Could not post comment");
	}
}
