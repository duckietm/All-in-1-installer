// @ts-nocheck
import { describe, expect, it } from "vitest";
import { readArticleInput } from "./article-input";
import { publicationIssues, safePublicationUrl } from "./publication-preflight";

describe("publication preflight", () => {
	it("allows local images and web links but rejects unsafe schemes and credentials", () => {
		expect(safePublicationUrl("/images/news.png", true)).toBe(true);
		expect(safePublicationUrl("https://example.com/image.png", true)).toBe(
			true,
		);
		for (const url of [
			"javascript:alert(1)",
			"//external.test/image",
			"https://user:password@example.com/a",
			"data:text/html,test",
			"https:\\example.com",
		]) {
			expect(safePublicationUrl(url, true)).toBe(false);
		}
	});
	it("checks encoded link schemes without fetching destinations", () => {
		const issues = publicationIssues({
			kind: "article",
			image: "/cover.png",
			body: '<a href="java&#x73;cript:alert(1)">bad</a>',
		});
		expect(issues).toContainEqual({
			code: "linksInvalid",
			severity: "error",
			field: "fullStory",
		});
		expect(
			publicationIssues({
				kind: "article",
				image: "/cover.png",
				body: '<a href="/help">Help</a><a href="mailto:help@example.com">Mail</a>',
			}),
		).toEqual([]);
	});
	it("rejects reversed event dates and distinguishes a past-date warning", () => {
		expect(
			publicationIssues({
				kind: "event",
				startsAt: "2030-01-02",
				endsAt: "2030-01-01",
			}),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "scheduleInvalid", severity: "error" }),
			]),
		);
		expect(
			publicationIssues(
				{ kind: "event", startsAt: "2020-01-01" },
				Date.parse("2021-01-01"),
			),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "schedulePast", severity: "warning" }),
			]),
		);
	});
	it("warns for missing image and normalized slug without blocking drafts", () => {
		const issues = publicationIssues({
			kind: "article",
			slug: "Hello World",
			normalizedSlug: "hello-world",
		});
		expect(issues.map((i) => i.code)).toEqual([
			"imageMissing",
			"slugNormalized",
		]);
		expect(issues.every((i) => i.severity === "warning")).toBe(true);
	});
	it("requires a valid scheduled publication date", () => {
		expect(
			publicationIssues({
				kind: "article",
				status: "scheduled",
				publishAt: "",
			}),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "scheduleInvalid" }),
			]),
		);
	});
	it("enforces image and link checks in server article input but preserves draft saving", () => {
		const form = new FormData();
		form.set("title", "News");
		form.set("image", "javascript:alert(1)");
		expect(() => readArticleInput(form)).toThrow("imageInvalid");
		form.set("status", "draft");
		expect(readArticleInput(form).image).toBe("javascript:alert(1)");
		form.set("status", "published");
		form.set("image", "/cover.png");
		form.set("fullStory", '<a href="javascript:alert(1)">bad</a>');
		expect(() => readArticleInput(form)).toThrow("linksInvalid");
	});
});
