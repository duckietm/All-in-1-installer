// @ts-nocheck
import { afterEach, expect, it, vi } from "vitest";
import { verifyRuntimeMetadata } from "../../scripts/verify-runtime-metadata.mjs";

afterEach(() => vi.unstubAllGlobals());
it("verifies runtime names and domains without requesting DB-dependent login HTML", async () => {
	const fetcher = vi.fn(async (url: string) => {
		if (url.endsWith("/login"))
			return new Response("Database unavailable", { status: 500 });
		return url.endsWith("webmanifest")
			? Response.json({ name: "Fixture alpha" })
			: new Response("https://alpha.test/sitemap.xml");
	});
	vi.stubGlobal("fetch", fetcher);
	await expect(
		verifyRuntimeMetadata("https://alpha.test", "alpha"),
	).resolves.toBeUndefined();
	expect(fetcher.mock.calls.map((c) => c[0])).not.toContain(
		"https://alpha.test/login",
	);
});
it.each(["manifest", "domain", "http"])("rejects wrong %s", async (mode) => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) =>
			url.endsWith("webmanifest")
				? Response.json(
						{ name: mode === "manifest" ? "Build fixture" : "Fixture alpha" },
						{ status: mode === "http" ? 500 : 200 },
					)
				: new Response("https://wrong.test"),
		),
	);
	await expect(
		verifyRuntimeMetadata("https://alpha.test", "alpha"),
	).rejects.toThrow();
});
