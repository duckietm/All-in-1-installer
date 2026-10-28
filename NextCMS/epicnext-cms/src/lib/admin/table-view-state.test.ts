import { describe, expect, it } from "vitest";
import {
	captureTableView,
	namedTableView,
	tableViewPath,
} from "./table-view-state";

describe("saved table views", () => {
	it("keeps filters and sorting but discards page and credentials", () => {
		expect(
			captureTableView(
				"search=test&page=4&sort=id&order=asc&filter_rank=7&token=secret&redirect=https://evil.invalid",
				["name"],
			),
		).toEqual({
			params: { search: "test", sort: "id", order: "asc", filter_rank: "7" },
			hidden: ["name"],
		});
	});
	it("rejects external and traversal paths", () => {
		for (const path of [
			"https://evil.invalid/admin/users",
			"/admin/../me",
			"//admin/users",
			"/me",
		])
			expect(tableViewPath.safeParse(path).success).toBe(false);
		expect(tableViewPath.safeParse("/admin/tickets/desk").success).toBe(true);
	});
	it("rejects unsafe or oversized stored state", () => {
		expect(
			namedTableView.safeParse({
				name: "Test",
				state: { params: { password: "secret" }, hidden: [] },
			}).success,
		).toBe(false);
		expect(
			namedTableView.safeParse({ name: " ", state: { params: {}, hidden: [] } })
				.success,
		).toBe(false);
		expect(
			namedTableView.safeParse({
				name: "Test",
				state: { params: { search: "x".repeat(201) }, hidden: [] },
			}).success,
		).toBe(false);
	});
});
