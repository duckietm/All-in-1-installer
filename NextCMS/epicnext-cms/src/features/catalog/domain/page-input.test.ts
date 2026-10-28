import { expect, it } from "vitest";
import { pagePatchSchema } from "./page-input";

it("preserves nullable page texts when editing unrelated fields", () => {
	const fields = {
		caption: "Changed",
		pageText1: null,
		pageText2: null,
		pageTextDetails: null,
		pageTextTeaser: null,
		pageSpecial: null,
	};
	expect(pagePatchSchema.parse(fields)).toEqual(fields);
});
it("preserves valid zero values and rejects invalid flags", () => {
	expect(
		pagePatchSchema.parse({ parentId: 0, orderNum: 0, iconImage: 0 }),
	).toEqual({ parentId: 0, orderNum: 0, iconImage: 0 });
	expect(() => pagePatchSchema.parse({ enabled: "true" })).toThrow();
});

it("preserves caption whitespace for optimistic comparisons but rejects blank captions", () => {
	expect(pagePatchSchema.parse({ caption: " Existing " })).toEqual({
		caption: " Existing ",
	});
	expect(() => pagePatchSchema.parse({ caption: "   " })).toThrow();
});
