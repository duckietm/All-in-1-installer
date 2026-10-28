// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	settings: {} as Record<string, unknown>,
}));

vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: {
		get: async (key: string, fallback?: unknown) =>
			key in state.settings ? state.settings[key] : fallback,
		getBool: async (key: string, fallback: boolean) =>
			key in state.settings ? Boolean(state.settings[key]) : fallback,
	},
}));

import { checkVpn } from "./ip-lookup";

function jsonResponse(body: unknown) {
	return { ok: true, json: async () => body };
}

beforeEach(() => {
	state.settings = {};
	vi.unstubAllGlobals();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("checkVpn", () => {
	it("does not block empty or private addresses", async () => {
		expect(await checkVpn("")).toEqual({ blocked: false });
		expect(await checkVpn("127.0.0.1")).toEqual({ blocked: false });
		expect(await checkVpn("10.1.2.3")).toEqual({ blocked: false });
		expect(await checkVpn("192.168.1.5")).toEqual({ blocked: false });
		expect(await checkVpn("172.16.0.1")).toEqual({ blocked: false });
		expect(await checkVpn("::1")).toEqual({ blocked: false });
		expect(await checkVpn("localhost")).toEqual({ blocked: false });
	});

	it("does not block when the feature is disabled", async () => {
		state.settings.vpn_block_enabled = false;
		expect(await checkVpn("8.8.8.8")).toEqual({ blocked: false });
	});

	it("blocks ipqualityscore hits", async () => {
		state.settings.vpn_block_enabled = true;
		state.settings.vpn_provider = "ipqualityscore";
		state.settings.vpn_api_key = "key-1";
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ vpn: true }));
		vi.stubGlobal("fetch", fetchMock);
		expect(await checkVpn("8.8.8.8")).toEqual({
			blocked: true,
			reason: "VPN/proxy detected",
		});
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/key-1/8.8.8.8");
	});

	it("passes clean ipqualityscore responses", async () => {
		state.settings.vpn_block_enabled = true;
		state.settings.vpn_provider = "ipqualityscore";
		state.settings.vpn_api_key = "key-1";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(jsonResponse({ proxy: false })),
		);
		expect(await checkVpn("8.8.8.8")).toEqual({ blocked: false });
	});

	it("skips ipqualityscore when no api key is configured", async () => {
		state.settings.vpn_block_enabled = true;
		state.settings.vpn_provider = "ipqualityscore";
		state.settings.vpn_api_key = "";
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		expect(await checkVpn("8.8.8.8")).toEqual({ blocked: false });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("blocks proxycheck hits with the detected type", async () => {
		state.settings.vpn_block_enabled = true;
		state.settings.vpn_provider = "proxycheck";
		state.settings.vpn_api_key = "abc";
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				jsonResponse({ "8.8.8.8": { proxy: "yes", type: "Tor" } }),
			);
		vi.stubGlobal("fetch", fetchMock);
		expect(await checkVpn("8.8.8.8")).toEqual({
			blocked: true,
			reason: "Tor detected",
		});
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain("key=abc");
	});

	it("passes clean proxycheck responses", async () => {
		state.settings.vpn_block_enabled = true;
		state.settings.vpn_provider = "proxycheck";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(jsonResponse({ "8.8.8.8": {} })),
		);
		expect(await checkVpn("8.8.8.8")).toEqual({ blocked: false });
	});

	it("fails open when the provider throws", async () => {
		state.settings.vpn_block_enabled = true;
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("network down")),
		);
		expect(await checkVpn("8.8.8.8")).toEqual({ blocked: false });
	});
});
