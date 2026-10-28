import { expect, it } from "vitest";
import { userDetailHref, userListHref } from "./user-list-navigation";

it("preserves search filters and pagination through detail and edit links", () => {
	const query = "search=Mario%20Rossi&page=3&filter_online=1&perPage=50";
	for (const mode of ["show", "edit"] as const) {
		const link = new URL(
			userDetailHref(9, mode, query),
			"https://example.test",
		);
		expect(userListHref(link.searchParams.get("list") ?? "")).toBe(
			"/admin/users?search=Mario+Rossi&page=3&filter_online=1&perPage=50",
		);
	}
});
it("always returns a local users-list URL", () => {
	expect(userListHref("")).toBe("/admin/users");
	expect(userListHref("https://other.example")).toMatch(/^\/admin\/users\?/);
});
