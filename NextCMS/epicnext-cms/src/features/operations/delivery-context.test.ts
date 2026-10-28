// @ts-nocheck
import { describe, expect, it } from "vitest";
import { deliveryContext, deliveryTopic } from "./delivery-context";

describe("delivery context", () => {
	it("links a news record without rounding a bigint identifier", () => {
		expect(
			deliveryContext(
				"news.update",
				JSON.stringify({
					articleId: "9007199254740993",
					articleTitle: "A community update",
				}),
				{ news: true, catalog: false },
			),
		).toEqual({
			title: "A community update",
			href: "/admin/articles/9007199254740993",
			changedCount: null,
		});
	});
	it("does not expose news metadata without news permission", () => {
		expect(
			deliveryContext(
				"news.create",
				JSON.stringify({
					articleTitle: "Private draft",
					articleSlug: "private",
				}),
				{ news: false, catalog: true },
			),
		).toEqual({ title: null, href: null, changedCount: null });
	});
	it("supports searchable new articles and legacy scheduled records", () => {
		expect(
			deliveryContext(
				"news.create",
				JSON.stringify({
					articleTitle: "Hello & welcome",
					articleSlug: "hello",
				}),
				{ news: true, catalog: false },
			).href,
		).toBe("/admin/articles?search=Hello+%26+welcome");
		expect(
			deliveryContext(
				"news.schedule.publish",
				'{"articleId":"42","published":true}',
				{ news: true, catalog: false },
			).href,
		).toBe("/admin/articles/42");
	});
	it.each([
		null,
		"{broken",
		"[]",
		'{"articleId":"../../settings","articleTitle":42}',
		'"value"',
	])("handles missing or invalid historical context: %s", (result) => {
		expect(
			deliveryContext("news.update", result, { news: true, catalog: false }),
		).toEqual({ title: null, href: "/admin/articles", changedCount: null });
	});
	it("exposes only known bounded catalog counts with catalog permission", () => {
		expect(
			deliveryContext("catalog.bulk.apply", '{"changedCount":8}', {
				news: false,
				catalog: true,
			}),
		).toEqual({ title: null, href: "/admin/catalog", changedCount: 8 });
		expect(
			deliveryContext("catalog.bulk.apply", '{"changedCount":8}', {
				news: true,
				catalog: false,
			}).changedCount,
		).toBeNull();
		expect(
			deliveryContext("catalog.bulk.undo", '{"changedCount":-1}', {
				news: false,
				catalog: true,
			}).changedCount,
		).toBeNull();
	});
	it("does not interpret unknown operations or topics as export", () => {
		expect(
			deliveryContext("future.operation", '{"articleTitle":"secret"}', {
				news: true,
				catalog: true,
			}),
		).toEqual({ title: null, href: null, changedCount: null });
		expect(deliveryTopic("unknown.topic")).toBe("unknown");
		expect(deliveryTopic("news.refresh")).toBe("news");
	});
});
