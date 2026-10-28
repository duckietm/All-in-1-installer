import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
	it("keeps same-site destinations", () => {
		expect(safeRedirectPath("/admin/users")).toBe("/admin/users");
		expect(safeRedirectPath("/me")).toBe("/me");
		expect(safeRedirectPath("/login?from=%2Fadmin")).toBe(
			"/login?from=%2Fadmin",
		);
		expect(safeRedirectPath("/news/welcome#comments")).toBe(
			"/news/welcome#comments",
		);
	});

	it("refuses cross-origin and non-path destinations", () => {
		expect(safeRedirectPath("//evil.example")).toBe("/me");
		expect(safeRedirectPath("/\\evil.example")).toBe("/me");
		expect(safeRedirectPath("https://evil.example")).toBe("/me");
		expect(safeRedirectPath("javascript:alert(1)")).toBe("/me");
		expect(safeRedirectPath("admin")).toBe("/me");
	});

	it("treats a missing value as the fallback", () => {
		expect(safeRedirectPath(undefined)).toBe("/me");
		expect(safeRedirectPath(null)).toBe("/me");
		expect(safeRedirectPath("")).toBe("/me");
		expect(safeRedirectPath(undefined, "/admin")).toBe("/admin");
	});
});
