// @ts-nocheck
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { articleSlug, readArticleInput } from "./article-input";

it("normalizes Next catch-all slug parameters", () => {
	expect(articleSlug(["welcome"])).toBe("welcome");
	expect(articleSlug("welcome")).toBe("welcome");
});
it("keeps the selected timezone instant when scheduling", () => {
	const form = new FormData();
	form.set("title", "News");
	form.set("status", "scheduled");
	form.set("publishAt", "2026-09-06T20:00:00+02:00");
	expect(readArticleInput(form).publishAt?.toISOString()).toBe(
		"2026-09-06T18:00:00.000Z",
	);
});
it("ships additive publication columns for existing installations", () => {
	const sql = readFileSync(
		"drizzle/migrations/0025_article_publication.sql",
		"utf8",
	);
	for (const column of ["status", "publish_at", "published_at"])
		expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
	expect(sql).toContain("DEFAULT 'published'");
	expect(sql).not.toMatch(/DROP|UPDATE\s+website_articles/i);
});
