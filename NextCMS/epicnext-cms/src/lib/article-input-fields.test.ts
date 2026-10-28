// @ts-nocheck
import { expect, it } from "vitest";
import { articleInputField } from "./article-input";

it("maps correctable article failures and keeps conflicts global", () => {
	expect(articleInputField("titleRequired")).toBe("title");
	expect(articleInputField("summaryTooLong")).toBe("shortStory");
	expect(articleInputField("publishDateRequired")).toBe("publishAt");
	expect(articleInputField("editConflict")).toBeUndefined();
	expect(articleInputField("articleNotFound")).toBeUndefined();
});
