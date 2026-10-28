export type ArticleDraft = {
	title: string;
	slug: string;
	image: string;
	shortStory: string;
	fullStory: string;
	status: string;
	publishAt: string;
	baseToken: string;
};
export function readArticleDraft(form: FormData): ArticleDraft {
	const keys = [
		"title",
		"slug",
		"image",
		"shortStory",
		"fullStory",
		"status",
		"publishAt",
		"baseToken",
	] as const;
	const result = {} as ArticleDraft;
	for (const key of keys) {
		const value = form.get(key) ?? "";
		if (
			typeof value !== "string" ||
			value.length > (key === "fullStory" ? 500_000 : 255)
		)
			throw new Error("draftInvalid");
		result[key] = value;
	}
	if (!["draft", "scheduled", "published"].includes(result.status))
		throw new Error("draftInvalid");
	return result;
}
export function articleKey(value: string): string {
	if (value === "new" || /^[1-9]\d{0,19}$/.test(value)) return value;
	throw new Error("draftInvalid");
}
