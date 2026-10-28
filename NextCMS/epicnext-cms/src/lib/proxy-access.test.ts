// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
	isCacheableAssetPath,
	shouldRedirectAdminRequest,
} from "./proxy-access";

describe("shouldRedirectAdminRequest", () => {
	it("redirects anonymous admin requests before rendering", () => {
		expect(shouldRedirectAdminRequest("/admin", null)).toBe(true);
	});

	it("defers every authenticated rank to database authorization", () => {
		expect(shouldRedirectAdminRequest("/admin/permissions", { rank: 1 })).toBe(
			false,
		);
		expect(
			shouldRedirectAdminRequest("/admin/permissions", { rank: 2000 }),
		).toBe(false);
		expect(shouldRedirectAdminRequest("/news", null)).toBe(false);
	});
});

describe("isCacheableAssetPath", () => {
	it("keeps rendered avatars and uploaded media cacheable", () => {
		expect(isCacheableAssetPath("/api/imaging/avatar")).toBe(true);
		expect(isCacheableAssetPath("/api/imaging/badge")).toBe(true);
		expect(isCacheableAssetPath("/api/media/1730000000000-abc.png")).toBe(true);
	});

	it("never lets a document or API route reuse the asset cache policy", () => {
		expect(isCacheableAssetPath("/")).toBe(false);
		expect(isCacheableAssetPath("/news")).toBe(false);
		expect(isCacheableAssetPath("/api/news")).toBe(false);
		expect(isCacheableAssetPath("/api/media-library")).toBe(false);
		expect(isCacheableAssetPath("/api/imaging")).toBe(false);
		expect(isCacheableAssetPath("/admin/media")).toBe(false);
	});
});
