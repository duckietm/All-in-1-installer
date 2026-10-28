// @ts-nocheck
import { expect, it } from "vitest";
import { articleKey, readArticleDraft } from "./article-draft";
import { articleEditToken } from "./article-edit-token";

it("allows incomplete drafts without requiring publication-ready fields", () => {
	const form = new FormData();
	form.set("status", "scheduled");
	expect(readArticleDraft(form)).toMatchObject({
		title: "",
		fullStory: "",
		publishAt: "",
		status: "scheduled",
	});
});
it("rejects unbounded or malformed recovery keys", () => {
	for (const key of ["", "../1", "0", "-1", "1e5", "1".repeat(21)])
		expect(() => articleKey(key)).toThrow();
	expect(articleKey("new")).toBe("new");
	expect(articleKey("123")).toBe("123");
});
it("detects body and scheduled instant changes even within the same clock second", () => {
	const row = {
		title: "News",
		slug: "news",
		image: "",
		shortStory: "",
		fullStory: "old",
		status: "scheduled",
		publishAt: new Date("2030-01-01T00:00:00Z"),
	};
	expect(articleEditToken(row)).not.toBe(
		articleEditToken({ ...row, fullStory: "new" }),
	);
	expect(articleEditToken(row)).not.toBe(
		articleEditToken({ ...row, publishAt: new Date("2030-01-01T01:00:00Z") }),
	);
	expect(articleEditToken(row)).toBe(articleEditToken({ ...row }));
});
