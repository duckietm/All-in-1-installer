// @ts-nocheck
import { describe, expect, it } from "vitest";
import { normalizeClientIp, resolveClientIp } from "./client-ip";

describe("normalized client IP addresses", () => {
	it.each([
		[" 192.0.2.1 ", "192.0.2.1"],
		["2001:DB8:0:0:0:0:0:1", "2001:db8::1"],
		["2001:db8::1", "2001:db8::1"],
		["::1", "::1"],
		["::ffff:192.0.2.1", "192.0.2.1"],
		["::ffff:c000:201", "192.0.2.1"],
	])("canonicalizes %s", (input, expected) => {
		expect(normalizeClientIp(input)).toBe(expected);
	});

	it.each([
		undefined,
		null,
		"",
		" ",
		"unknown",
		"localhost",
		"192.0.2.999",
		"192.000.2.1",
		"192.0.2.1:8080",
		"[2001:db8::1]",
		"[::1]:443",
		"fe80::1%eth0",
		"192.0.2.1, 192.0.2.2",
		"::g",
		"1".repeat(1000),
	])("rejects malformed or ambiguous input %s", (input) => {
		expect(normalizeClientIp(input)).toBeNull();
	});

	it("falls back to the trusted ingress header when a spoofed Cloudflare header lacks cf-ray", () => {
		expect(
			resolveClientIp(
				new Headers({
					"cf-connecting-ip": "invalid",
					"x-forwarded-for": " 192.0.2.10, 192.0.2.20 ",
					"x-real-ip": "192.0.2.30",
					"x-real-client-ip": "198.51.100.99",
				}),
			),
		).toBe("192.0.2.30");
	});

	it("ignores an invalid Cloudflare header on proxied traffic and uses the first forwarding entry", () => {
		expect(
			resolveClientIp(
				new Headers({
					"cf-ray": "8a9b-AMS",
					"cf-connecting-ip": "invalid",
					"x-forwarded-for": " 192.0.2.10, 192.0.2.20 ",
					"x-real-ip": "192.0.2.30",
					"x-real-client-ip": "198.51.100.99",
				}),
			),
		).toBe("192.0.2.10");
	});

	it("does not treat a later forwarding hop as the client when the first entry is empty", () => {
		expect(
			resolveClientIp(new Headers({ "x-forwarded-for": ", 192.0.2.20" })),
		).toBe("0.0.0.0");
	});
});
