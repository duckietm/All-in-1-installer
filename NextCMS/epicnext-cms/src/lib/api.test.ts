// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
	apiJson,
	apiOk,
	apiUnavailable,
	pagination,
	positiveBigInt,
	publicCacheControl,
} from "@/lib/api";

// Mirrors how a public read-only route opts in.
function publiclyCacheable(data: unknown, seconds: number) {
	return apiJson(data, {
		headers: { "cache-control": publicCacheControl(seconds) },
	});
}

describe("apiOk", () => {
	it("returns a BigInt-safe success envelope with ok: true", async () => {
		const response = apiOk({ id: 9007199254740993n });

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.json()).resolves.toEqual({
			ok: true,
			id: "9007199254740993",
		});
	});

	it("allows empty payloads", async () => {
		await expect(apiOk().json()).resolves.toEqual({ ok: true });
	});
});

describe("apiUnavailable", () => {
	it("returns a no-store 503 error without exposing internal details", async () => {
		const response = apiUnavailable("Account data is temporarily unavailable");

		expect(response.status).toBe(503);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.json()).resolves.toEqual({
			error: "Account data is temporarily unavailable",
		});
	});
});

describe("positiveBigInt", () => {
	it.each(["1", "9007199254740993"])("parses positive integer id %s", (raw) => {
		expect(positiveBigInt(raw)).toBe(BigInt(raw));
	});

	it.each([null, "", "0", "-1", "1.5", "abc"])(
		"rejects invalid id %s",
		(raw) => {
			expect(positiveBigInt(raw)).toBeNull();
		},
	);
});

describe("pagination", () => {
	it("rejects fractional and malformed values before they reach the DB layer", () => {
		const params = new URLSearchParams({ page: "2.5", perPage: "10.1" });

		expect(pagination(params, 20, 100)).toEqual({
			page: 1,
			perPage: 20,
			skip: 0,
			take: 20,
		});
	});

	it("clamps valid page sizes to the configured maximum", () => {
		const params = new URLSearchParams({ page: "3", perPage: "999" });

		expect(pagination(params, 20, 100)).toEqual({
			page: 3,
			perPage: 100,
			skip: 200,
			take: 100,
		});
	});
});

describe("publicCacheControl", () => {
	it("lets a shared cache answer without the request reaching the app", async () => {
		const response = publiclyCacheable({ rows: [1, 2, 3] }, 120);

		// s-maxage is the part a CDN in front of the app acts on.
		expect(response.headers.get("cache-control")).toContain("s-maxage=120");
		expect(response.headers.get("cache-control")).toContain("public");
		await expect(response.json()).resolves.toEqual({ rows: [1, 2, 3] });
	});

	it("keeps the previous body servable while it refreshes", () => {
		expect(publicCacheControl(60)).toContain("stale-while-revalidate=60");
	});

	it("stays no-store by default, because most routes here are personal", async () => {
		// Auth, admin and per-viewer routes keep this. If this ever defaults to
		// something cacheable, private data ends up in a shared cache.
		expect(apiOk({}).headers.get("cache-control")).toBe("no-store");
		expect(publiclyCacheable({ a: 1 }, 60).status).toBe(200);
	});
});
