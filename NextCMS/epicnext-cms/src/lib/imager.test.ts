// @ts-nocheck
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AVATAR_FIGURE } from "./avatar-figure";
import { getAvatarUrl } from "./imager";
import {
	FALLBACK_TIMEOUT_MS,
	fetchAvatarImage,
	PRIMARY_TIMEOUT_MS,
} from "./imager-upstream";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("getAvatarUrl", () => {
	beforeEach(() => {
		vi.stubEnv("NEXT_PUBLIC_IMAGER_URL", "https://img.example.com");
	});

	it("builds a query string with defaults (omits default params)", () => {
		const url = getAvatarUrl("hd-180-1");
		expect(url.startsWith("/cms_api/imaging/avatar?")).toBe(true);
		expect(url).toContain("figure=hd-180-1");
		expect(url).not.toContain("direction=2");
		expect(url).not.toContain("head_direction=3");
		expect(url).not.toContain("size=m");
		expect(url).toContain("img_format=apng");
		expect(url).toContain("effect=14");
	});

	it("honors custom options", () => {
		const url = getAvatarUrl("hd-180-1", {
			size: "l",
			direction: 1,
			headDirection: 2,
			headOnly: true,
			gesture: "sml",
			action: "sit",
		});
		expect(url).toContain("size=l");
		expect(url).toContain("direction=1");
		expect(url).toContain("head_direction=2");
		expect(url).toContain("headonly=1");
		expect(url).toContain("gesture=sml");
		expect(url).toContain("action=sit");
	});

	it("escapes figure values in the query string", () => {
		const url = getAvatarUrl("hd-180-1&x=1");
		expect(url).not.toContain("&x=1");
	});

	it("falls back to the default when the stored look is malformed", () => {
		const url = getAvatarUrl("hr-100-.hd-180-1.ch-255-66.lg-280-110.sh-305-62");
		expect(url).toContain(`figure=${DEFAULT_AVATAR_FIGURE}`);
	});

	it("allows custom img_format", () => {
		const url = getAvatarUrl("hd-180-1", { img_format: "png" });
		expect(url).toContain("img_format=png");
	});

	it("allows custom effect", () => {
		const url = getAvatarUrl("hd-180-1", { effect: 0 });
		expect(url).toContain("effect=0");
	});

	it("uses the local runtime proxy when no env var is set", () => {
		vi.stubEnv("NEXT_PUBLIC_IMAGER_URL", "");
		const url = getAvatarUrl("hd-180-1");
		expect(url.startsWith("/cms_api/imaging/avatar?")).toBe(true);
		expect(url).toContain("img_format=apng");
		expect(url).toContain("effect=14");
	});
});

describe("upstream render budgets", () => {
	it("keeps enough headroom for APNG effect renders", () => {
		expect(PRIMARY_TIMEOUT_MS).toBeGreaterThanOrEqual(8_000);
	});

	it("does not stack a long fallback wait on a slow primary", () => {
		expect(FALLBACK_TIMEOUT_MS).toBeLessThan(PRIMARY_TIMEOUT_MS);
	});
});

describe("fetchAvatarImage caching", () => {
	let cacheRoot = "";

	beforeEach(() => {
		cacheRoot = mkdtempSync(join(tmpdir(), "imager-cache-"));
		vi.stubEnv("IMAGING_CACHE_ROOT", cacheRoot);
		vi.stubEnv("IMAGER_URL", "http://primary.invalid/avatarimage");
		vi.stubEnv("IMAGING_UPSTREAM_URL", "http://primary.invalid/avatarimage");
		vi.stubEnv("APP_URL", "https://cms.example");
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		rmSync(cacheRoot, { recursive: true, force: true });
	});

	const params = () =>
		new URLSearchParams({
			figure: "hd-180-1",
			direction: "2",
			head_direction: "3",
			size: "m",
			img_format: "png",
		});

	it("persists renders from the primary renderer", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(new Uint8Array([1, 2, 3]), {
						headers: { "content-type": "image/png" },
					}),
			),
		);

		const first = await fetchAvatarImage("https://cms.example", params());
		expect(first.source).toBe("primary");
		expect(readdirSync(join(cacheRoot, "avatars")).length).toBe(2);

		const second = await fetchAvatarImage("https://cms.example", params());
		expect(second.source).toBe("cache");
	});

	it("never persists a fallback render", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string | URL) =>
				String(url).includes("primary.invalid")
					? new Response(null, { status: 500 })
					: new Response(new Uint8Array([4, 5, 6]), {
							headers: { "content-type": "image/png" },
						}),
			),
		);

		const result = await fetchAvatarImage("https://cms.example", params());
		expect(result.source).toBe("fallback");
		expect(() => readdirSync(join(cacheRoot, "avatars"))).toThrow();
	});
});
