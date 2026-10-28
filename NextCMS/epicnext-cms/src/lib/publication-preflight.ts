export type PublicationIssueCode =
	| "imageMissing"
	| "imageInvalid"
	| "linksInvalid"
	| "scheduleInvalid"
	| "schedulePast"
	| "slugNormalized";
export interface PublicationIssue {
	code: PublicationIssueCode;
	severity: "error" | "warning";
	field: string;
}
export interface PublicationInput {
	kind: "article" | "event";
	image?: string | null;
	body?: string;
	slug?: string;
	normalizedSlug?: string;
	status?: string;
	publishAt?: Date | string | null;
	startsAt?: Date | string | null;
	endsAt?: Date | string | null;
}
export function safePublicationUrl(value: string, image = false): boolean {
	const text = value.trim();
	if (
		!text ||
		[...text].some((char) => char.charCodeAt(0) <= 32 || char === "\\")
	)
		return false;
	if (text.startsWith("/") && !text.startsWith("//")) return true;
	if (!image && text.startsWith("#")) return true;
	try {
		const url = new URL(text);
		return (
			!url.username &&
			!url.password &&
			(url.protocol === "https:" ||
				url.protocol === "http:" ||
				(!image && url.protocol === "mailto:"))
		);
	} catch {
		return false;
	}
}
function decodeLink(value: string): string {
	return value
		.replace(/&#(x[\da-f]+|\d+);?/gi, (_all, code: string) => {
			const n =
				code[0].toLowerCase() === "x"
					? Number.parseInt(code.slice(1), 16)
					: Number(code);
			return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
		})
		.replace(/&colon;/gi, ":")
		.replace(/&amp;/gi, "&");
}
export function publicationIssues(
	input: PublicationInput,
	now = Date.now(),
): PublicationIssue[] {
	const issues: PublicationIssue[] = [];
	if (!input.image?.trim())
		issues.push({ code: "imageMissing", severity: "warning", field: "image" });
	else if (!safePublicationUrl(input.image, true))
		issues.push({ code: "imageInvalid", severity: "error", field: "image" });
	if (input.kind === "article") {
		const links = [
			...(input.body ?? "").matchAll(
				/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
			),
		].map((match) => decodeLink(match[1] ?? match[2] ?? match[3] ?? ""));
		if (links.some((link) => !safePublicationUrl(link)))
			issues.push({
				code: "linksInvalid",
				severity: "error",
				field: "fullStory",
			});
		if (
			input.slug &&
			input.normalizedSlug &&
			input.slug !== input.normalizedSlug
		)
			issues.push({
				code: "slugNormalized",
				severity: "warning",
				field: "slug",
			});
	}
	const date =
		input.kind === "event"
			? input.startsAt
			: input.status === "scheduled"
				? input.publishAt
				: null;
	if (input.kind === "event" || input.status === "scheduled") {
		const start = date ? new Date(date).getTime() : NaN;
		const end = input.endsAt ? new Date(input.endsAt).getTime() : null;
		if (
			!Number.isFinite(start) ||
			(end !== null && (!Number.isFinite(end) || end <= start))
		)
			issues.push({
				code: "scheduleInvalid",
				severity: "error",
				field: input.kind === "event" ? "startsAt" : "publishAt",
			});
		else if (start < now)
			issues.push({
				code: "schedulePast",
				severity: "warning",
				field: input.kind === "event" ? "startsAt" : "publishAt",
			});
	}
	return issues;
}
