import { describe, expect, it } from "vitest";

import { classifyDdos, isSuspiciousPath } from "@/lib/ddos";

describe("classifyDdos", () => {
	it.each([
		["/", "pages"],
		["/community", "pages"],
		["/login", "auth"],
		["/login/", "auth"],
		["/register", "auth"],
		["/admin", "auth"],
		["/admin/home", "auth"],
		["/cms_api/auth/callback/credentials", "auth"],
		["/cms_api/articles/hello", "api"],
		["/cms_api/radio/stream", "api"],
		// Imaging is deliberately in the `api` bucket: it is high-volume and
		// cacheable, so it gets the generous api budget, not the page budget.
		["/cms_api/imaging/avatar", "api"],
		["/cms_api/imaging/badge", "api"],
	])(`classifies %s as %s`, (pathname, expected) => {
		expect(classifyDdos(pathname)).toBe(expected);
	});
});

describe("isSuspiciousPath", () => {
	it.each([
		["/wp-admin/index.php", true],
		["/wp-login.php", true],
		["/.env", true],
		["/.git/config", true],
		["/phpmyadmin/", true],
		["/server-status", true],
		["/index.php", true],
		["/shell.aspx", true],
	])(`flags scanner path %s`, (pathname, expected) => {
		expect(isSuspiciousPath(pathname)).toBe(expected);
	});

	it("does not flag real app routes", () => {
		expect(isSuspiciousPath("/")).toBe(false);
		expect(isSuspiciousPath("/community")).toBe(false);
		expect(isSuspiciousPath("/cms_api/health")).toBe(false);
		expect(isSuspiciousPath("/login")).toBe(false);
		expect(isSuspiciousPath("/news/article/hello-world")).toBe(false);
	});
});
