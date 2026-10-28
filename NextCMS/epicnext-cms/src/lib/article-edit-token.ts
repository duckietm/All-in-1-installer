import { createHash } from "node:crypto";
export function articleEditToken(article: {
	title: string;
	slug: string;
	image: string;
	shortStory: string;
	fullStory: string;
	status: string;
	publishAt: Date | null;
}) {
	return createHash("sha256")
		.update(
			JSON.stringify([
				article.title,
				article.slug,
				article.image,
				article.shortStory,
				article.fullStory,
				article.status,
				article.publishAt?.toISOString() ?? "",
			]),
		)
		.digest("hex");
}
