import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __clearGordonCache, resolveGordonBuildUrl } from "./gordon";

beforeEach(() => {
	__clearGordonCache();
	vi.restoreAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe("import/core/gordon", () => {
	it("parses flash.client.url from external_variables and normalizes", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				"flash.client.url=//images.habbo.com/gordon/PRODUCTION-XYZ/\n",
				{ status: 200 },
			),
		);
		expect(await resolveGordonBuildUrl()).toBe(
			"https://images.habbo.com/gordon/PRODUCTION-XYZ/",
		);
	});

	it("caches the resolved build (second call does not refetch)", async () => {
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				new Response("flash.client.url=//x/gordon/B/\n", { status: 200 }),
			);
		await resolveGordonBuildUrl();
		await resolveGordonBuildUrl();
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("throws when flash.client.url is absent", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("other=1\n", { status: 200 }),
		);
		await expect(resolveGordonBuildUrl()).rejects.toThrow();
	});
});
