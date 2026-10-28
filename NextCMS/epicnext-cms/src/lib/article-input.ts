import { publicationIssues } from "./publication-preflight";
import type { ActionResult } from "./safe-action-shared";
export type ArticleSaveResult = ActionResult<{ redirectTo: string }>;
export class ArticleInputError extends Error {
	constructor(
		public readonly code:
			| "articleNotFound"
			| "editConflict"
			| "titleRequired"
			| "titleTooLong"
			| "summaryTooLong"
			| "imageTooLong"
			| "invalidStatus"
			| "publishDateRequired"
			| "imageInvalid"
			| "linksInvalid",
	) {
		super(code);
	}
}
export function readArticleInput(form: FormData) {
	const text = (key: string) =>
		String(form.get(key) ?? "")
			.normalize("NFC")
			.trim();
	const title = text("title"),
		shortStory = text("shortStory"),
		fullStory = text("fullStory"),
		image = text("image");
	if (!title) throw new ArticleInputError("titleRequired");
	if (title.length > 255) throw new ArticleInputError("titleTooLong");
	if (shortStory.length > 255) throw new ArticleInputError("summaryTooLong");
	if (image.length > 255) throw new ArticleInputError("imageTooLong");
	const status = text("status") || "published";
	if (status !== "published" && status !== "draft" && status !== "scheduled")
		throw new ArticleInputError("invalidStatus");
	const publishAt = status === "scheduled" ? new Date(text("publishAt")) : null;
	if (publishAt && Number.isNaN(publishAt.getTime()))
		throw new ArticleInputError("publishDateRequired");
	if (status !== "draft") {
		const issue = publicationIssues({
			kind: "article",
			image,
			body: fullStory,
			status,
			publishAt,
		}).find((issue) => issue.severity === "error");
		if (issue?.code === "imageInvalid" || issue?.code === "linksInvalid")
			throw new ArticleInputError(issue.code);
	}
	return {
		title,
		shortStory,
		fullStory,
		image,
		status,
		publishAt,
		rawSlug: text("slug"),
	};
}
export function articleSlug(value: string | string[]): string {
	return Array.isArray(value) ? value.join("/") : value;
}

/** Associate validation failures with the field the editor can correct. */
export function articleInputField(
	code: ArticleInputError["code"],
): string | undefined {
	const fields: Partial<Record<ArticleInputError["code"], string>> = {
		titleRequired: "title",
		titleTooLong: "title",
		summaryTooLong: "shortStory",
		imageTooLong: "image",
		imageInvalid: "image",
		linksInvalid: "fullStory",
		invalidStatus: "status",
		publishDateRequired: "publishAt",
	};
	return fields[code];
}
