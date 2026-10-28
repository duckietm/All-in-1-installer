import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = [
	"a",
	"b",
	"blockquote",
	"br",
	"code",
	"em",
	"h1",
	"h2",
	"h3",
	"h4",
	"hr",
	"i",
	"img",
	"li",
	"ol",
	"p",
	"pre",
	"strong",
	"table",
	"tbody",
	"td",
	"th",
	"thead",
	"tr",
	"u",
	"ul",
];

const ALLOWED_ATTR = [
	"href",
	"src",
	"alt",
	"title",
	"target",
	"rel",
	"colspan",
	"rowspan",
];

export function sanitize(html: string | null | undefined): string {
	if (!html) return "";
	return DOMPurify.sanitize(html, {
		ALLOWED_TAGS,
		ALLOWED_ATTR,
		ALLOW_DATA_ATTR: false,
		FORBID_TAGS: ["style", "script", "svg", "math", "form", "input", "button"],
		USE_PROFILES: { html: true },
	});
}
