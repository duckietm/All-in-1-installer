// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminFetch } from "./admin-fetch";

const TOKEN = "a".repeat(64);
const REFRESHED_TOKEN = "b".repeat(64);

function installDocument(initialToken: string | null) {
	let token = initialToken;
	const meta = {
		getAttribute: (name: string) => (name === "content" ? token : null),
		setAttribute: (name: string, value: string) => {
			if (name === "content") token = value;
		},
	};

	vi.stubGlobal("document", {
		querySelector: () => (token ? meta : null),
		createElement: () => meta,
		head: { appendChild: vi.fn() },
	});
}

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("adminFetch CSRF handling", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("bootstraps a missing CSRF token before a mutating request", async () => {
		installDocument(null);
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(jsonResponse({ ok: true, token: TOKEN }))
			.mockResolvedValueOnce(jsonResponse({ ok: true }));
		vi.stubGlobal("fetch", fetchMock);

		const response = await adminFetch("/cms_api/admin/import/furni", {
			method: "POST",
		});

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0]?.[0]).toBe("/cms_api/admin/csrf");
		const requestHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
		expect(requestHeaders.get("x-csrf-token")).toBe(TOKEN);
	});

	it("refreshes and retries once when the server rejects a stale token", async () => {
		installDocument(TOKEN);
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				jsonResponse(
					{ ok: false, error: "Invalid or missing CSRF token" },
					403,
				),
			)
			.mockResolvedValueOnce(jsonResponse({ ok: true, token: REFRESHED_TOKEN }))
			.mockResolvedValueOnce(jsonResponse({ ok: true, imported: 1 }));
		vi.stubGlobal("fetch", fetchMock);

		const response = await adminFetch("/cms_api/admin/import/furni", {
			method: "POST",
		});

		expect(await response.json()).toEqual({ ok: true, imported: 1 });
		expect(fetchMock).toHaveBeenCalledTimes(3);
		const retryHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
		expect(retryHeaders.get("x-csrf-token")).toBe(REFRESHED_TOKEN);
	});

	it("does not bootstrap CSRF for read-only requests", async () => {
		installDocument(null);
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]));
		vi.stubGlobal("fetch", fetchMock);

		const response = await adminFetch("/cms_api/admin/import/furni");

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0]?.[0]).toBe("/cms_api/admin/import/furni");
	});
});
