// @ts-nocheck
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceAssetItem } from "@/lib/furni/source-assets";
import { inspectSourceAssets, probeAsset } from "./furniture-source-assets";

const source: SourceAssetItem = {
	id: 1,
	classname: "h25_monkeybzn_pole",
	name: "Jungle flags",
	description: "Flags",
	type: "flooritem",
	revision: 73253,
	category: "other",
};
const alternative = {
	...source,
	id: 2,
	classname: "br_c25_monkeybzn_pole",
	revision: 73257,
};
afterEach(() => vi.unstubAllGlobals());
describe("source asset preflight", () => {
	it("keeps missing furniture unchanged even when a similar asset is available", async () => {
		const fetchMock = vi.fn(
			async (url: string) =>
				new Response(null, { status: url.includes("/73257/") ? 200 : 404 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const result = await inspectSourceAssets(source, [source, alternative]);
		expect(result.state).toBe("missing");
		expect(result.classname).toBe(source.classname);
		expect(result.alternatives).toEqual([]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
	it("does not describe blocked or unreachable servers as missing files", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 403 })),
		);
		const result = await inspectSourceAssets(
			{ ...source, classname: "blocked_test" },
			[alternative],
		);
		expect(result.state).toBe("unknown");
		expect(result.alternatives).toEqual([]);
	});
	it("accepts an available configured Nitro source", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async (url: string) =>
					new Response(null, { status: url.endsWith(".nitro") ? 200 : 404 }),
			),
		);
		const result = await inspectSourceAssets(
			{ ...source, classname: "custom_test" },
			[],
			{
				id: "custom",
				name: "Custom",
				hotel: "",
				furnidataUrl: "https://source.example/data.json",
				nitroBaseUrl: "https://source.example/furniture",
				iconBaseUrl: "",
			},
		);
		expect(result.state).toBe("available");
	});
	it("caches a probe to avoid repeating CDN requests", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		await probeAsset("https://example.test/cache.nitro");
		await probeAsset("https://example.test/cache.nitro");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

const item = {
	id: 1,
	classname: "chair",
	name: "Chair",
	description: "",
	type: "flooritem",
	revision: 123,
	category: "other",
};

it("reports every missing filename and HTTP reason without credentials", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
	);
	const result = await inspectSourceAssets(item, [], {
		nitroBaseUrl: "https://user:secret@assets.test/private?token=secret",
	} as never);
	expect(result.state).toBe("missing");
	expect(result.attempts).toHaveLength(2);
	expect(result.attempts?.[1]).toMatchObject({
		file: "chair.swf",
		reason: "http",
		status: 404,
	});
	expect(JSON.stringify(result)).not.toContain("secret");
});
it("keeps network and blocked sources unknown rather than calling them missing", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockRejectedValue(new Error("https://secret.test/?token=secret")),
	);
	const result = await inspectSourceAssets({ ...item, revision: 124 }, []);
	expect(result.state).toBe("unknown");
	expect(result.attempts?.[0].reason).toBe("network");
	expect(JSON.stringify(result)).not.toContain("secret");
});
it("distinguishes HTML responses from valid assets", async () => {
	vi.stubGlobal(
		"fetch",
		vi
			.fn()
			.mockResolvedValue(
				new Response(null, { headers: { "content-type": "text/html" } }),
			),
	);
	const result = await inspectSourceAssets({ ...item, revision: 125 }, []);
	expect(result.attempts?.[0].reason).toBe("invalidResponse");
	expect(result.state).toBe("unknown");
});
