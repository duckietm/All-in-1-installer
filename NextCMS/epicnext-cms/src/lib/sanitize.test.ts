// @ts-nocheck
import { describe, expect, it } from "vitest";
import { sanitize } from "./sanitize";

describe("sanitize", () => {
	it("returns empty string for nullish input", () => {
		expect(sanitize(null)).toBe("");
		expect(sanitize(undefined)).toBe("");
		expect(sanitize("")).toBe("");
	});

	it("keeps safe formatting tags", () => {
		const out = sanitize("<p>Hello <strong>world</strong></p>");
		expect(out).toContain("<strong>world</strong>");
	});

	it("strips event handlers", () => {
		const out = sanitize('<img src="x.gif" onerror="alert(1)">');
		expect(out).not.toContain("onerror");
	});

	it("strips javascript: URLs", () => {
		const out = sanitize('<a href="javascript:alert(1)">click</a>');
		expect(out).not.toContain("javascript:");
	});

	it("strips svg onload vectors", () => {
		const out = sanitize('<svg onload="alert(1)"><circle r="10"/></svg>');
		expect(out).not.toContain("onload");
		expect(out).not.toContain("<svg");
	});

	it("strips script tags", () => {
		const out = sanitize("<p>hi</p><script>alert(1)</script>");
		expect(out).not.toContain("<script");
		expect(out).toContain("hi");
	});
});
