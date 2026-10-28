// @ts-nocheck
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	headers: new Headers(),
	headersUnavailable: false,
	session: null as { user: { id: string } } | null,
	issueSsoTicket: vi.fn(),
	insert: vi.fn(),
	recordRequest: vi.fn(),
	isIpBlacklisted: vi.fn(),
}));
vi.mock("next/headers", () => ({
	headers: async () => {
		if (state.headersUnavailable) throw Error("No request context");
		return state.headers;
	},
	cookies: vi.fn(),
}));
vi.mock("@/lib/redis", () => ({ redis: null }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ auth: async () => state.session }));
vi.mock("@/lib/auth/sso-ticket", () => ({
	issueSsoTicket: state.issueSsoTicket,
}));
vi.mock("@/lib/hotel-name", () => ({
	resolveHotelName: async () => "Integration",
}));
vi.mock("@/lib/cache", () => ({ cached: async () => 0 }));
vi.mock("@/app/client/client-view", () => ({ ClientView: () => null }));
vi.mock("next-auth/jwt", () => ({ getToken: async () => null }));
vi.mock("@/lib/services/abuse-guard", () => ({
	recordRequest: state.recordRequest,
	isIpBlacklisted: state.isIpBlacklisted,
}));
vi.mock("@/lib/services/site-settings", () => ({
	siteSettings: {
		getBool: async () => false,
		get: async () => "/nitro-client/",
	},
}));
vi.mock("@/lib/db", () => ({
	db: { insert: () => ({ values: state.insert }) },
	StaffActivities: {},
	Ban: {},
}));

import ClientPage from "@/app/client/page";
import { proxy } from "@/proxy";
import { enforceSiteAccess } from "./access-guard";
import { extractClientIpAsync } from "./foundation/security";
import { clientIp, rateLimit } from "./rate-limit";
import { logStaffActivity } from "./services/staff-activity";

beforeEach(() => {
	vi.clearAllMocks();
	state.headers = new Headers({ "x-pathname": "/me" });
	state.headersUnavailable = false;
	state.session = null;
	state.issueSsoTicket.mockResolvedValue("integration-ticket");
	state.insert.mockResolvedValue([{ insertId: 1 }]);
	state.recordRequest.mockResolvedValue(undefined);
	state.isIpBlacklisted.mockResolvedValue(false);
});

describe("client IP security consumers", () => {
	it.each([
		{
			headers: {
				"x-real-client-ip": "198.51.100.99",
				"x-forwarded-for": "192.0.2.10, 192.0.2.20",
			},
			expected: "192.0.2.10",
		},
		{
			headers: {
				"x-real-client-ip": "198.51.100.99",
				"cf-connecting-ip": "2001:DB8:0:0::1",
				"cf-ray": "abc123-FRA",
				"x-forwarded-for": "192.0.2.10",
			},
			expected: "2001:db8::1",
		},
		{ headers: { "x-real-client-ip": "198.51.100.99" }, expected: "0.0.0.0" },
		{
			headers: {
				"cf-connecting-ip": "",
				"x-forwarded-for": "malformed, 192.0.2.10",
				"x-real-ip": "192.0.2.30",
			},
			expected: "192.0.2.30",
		},
		{
			headers: {
				"cf-connecting-ip": "invalid",
				"x-forwarded-for": "",
				"x-real-ip": "192.0.2.1:8080",
			},
			expected: "0.0.0.0",
		},
	])(
		"uses the same validated address for rate limiting, security, access and staff audits: $expected",
		async ({ headers, expected }) => {
			for (const [name, value] of Object.entries(headers))
				state.headers.set(name, value);
			expect(await clientIp()).toBe(expected);
			expect(await extractClientIpAsync()).toBe(expected);
			await enforceSiteAccess();
			expect(state.recordRequest).toHaveBeenCalledWith(expected);
			expect(state.isIpBlacklisted).toHaveBeenCalledWith(expected);
			await logStaffActivity({
				staffId: 7,
				action: "test",
				description: "IP regression",
			});
			expect(state.insert).toHaveBeenCalledWith(
				expect.objectContaining({ ipAddress: expected }),
			);
		},
	);

	it("uses the normalized forwarded address for the game ticket", async () => {
		state.session = { user: { id: "7" } };
		state.headers.set("x-real-client-ip", "198.51.100.99");
		state.headers.set("x-forwarded-for", "192.0.2.10, 192.0.2.20");
		await ClientPage();
		expect(state.issueSsoTicket).toHaveBeenCalledWith(
			7,
			"Integration",
			"192.0.2.10",
		);
	});

	it("cannot obtain another API rate-limit bucket by changing the derived header", async () => {
		state.headers.set("x-forwarded-for", "192.0.2.10");
		state.headers.set("x-real-client-ip", "198.51.100.1");
		const key = `api-ip-regression:${randomUUID()}`;
		expect((await rateLimit(`${key}:${await clientIp()}`, 1, 60_000)).ok).toBe(
			true,
		);
		state.headers.set("x-real-client-ip", "198.51.100.2");
		expect((await rateLimit(`${key}:${await clientIp()}`, 1, 60_000)).ok).toBe(
			false,
		);
	});

	it("uses the unknown address when request headers are unavailable", async () => {
		state.headersUnavailable = true;
		expect(await clientIp()).toBe("0.0.0.0");
		expect(await extractClientIpAsync()).toBe("0.0.0.0");
		await logStaffActivity({
			staffId: 7,
			action: "test",
			description: "Missing request",
		});
		expect(state.insert).toHaveBeenCalledWith(
			expect.objectContaining({ ipAddress: "0.0.0.0" }),
		);
	});

	it.each<Record<string, string>>([{}, { "x-forwarded-for": "192.0.2.10" }])(
		"removes the incoming derived header from requests forwarded by the proxy",
		async (forwarded) => {
			const request = new NextRequest("http://localhost:3000/news", {
				headers: { ...forwarded, "x-real-client-ip": "198.51.100.99" },
			});
			const response = await proxy(request);
			expect(
				response.headers.get("x-middleware-request-x-real-client-ip"),
			).toBeNull();
			expect(
				response.headers.get("x-middleware-override-headers"),
			).not.toContain("x-real-client-ip");
			expect(response.headers.get("x-middleware-request-x-pathname")).toBe(
				"/news",
			);
		},
	);
});
