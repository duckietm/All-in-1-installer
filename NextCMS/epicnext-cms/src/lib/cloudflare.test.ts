import { describe, expect, it } from "vitest";
import { resolveClientIp } from "@/lib/client-ip";
import { isCloudflareProxied, preferredClientIpHeader } from "@/lib/cloudflare";

function headers(entries: Record<string, string>): Headers {
	const h = new Headers();
	for (const [k, v] of Object.entries(entries)) {
		if (v === "") h.set(k, "");
		else h.set(k, v);
	}
	return h;
}

describe("isCloudflareProxied", () => {
	it("detects Cloudflare from edge-stamped cf-ray or cdn-loop", () => {
		expect(isCloudflareProxied(headers({ "cf-ray": "abc123-FRA" }))).toBe(true);
		expect(isCloudflareProxied(headers({ "cdn-loop": "cloudflare" }))).toBe(
			true,
		);
		expect(
			isCloudflareProxied(
				headers({ "cf-connecting-ip": "1.2.3.4", "cf-ray": "abc-FRA" }),
			),
		).toBe(true);
	});

	it("treats a bare cf-connecting-ip as spoofable and not proof", () => {
		expect(
			isCloudflareProxied(headers({ "cf-connecting-ip": "1.2.3.4" })),
		).toBe(false);
		expect(isCloudflareProxied(headers({ "x-forwarded-for": "1.2.3.4" }))).toBe(
			false,
		);
		expect(isCloudflareProxied(headers({}))).toBe(false);
	});
});

describe("preferredClientIpHeader", () => {
	it("prefers cf-connecting-ip behind Cloudflare", () => {
		expect(
			preferredClientIpHeader(
				headers({ "cf-connecting-ip": "1.2.3.4", "cf-ray": "abc-FRA" }),
			),
		).toBe("cf-connecting-ip");
	});

	it("prefers ingress x-real-ip outside Cloudflare", () => {
		expect(
			preferredClientIpHeader(
				headers({
					"x-real-ip": "198.51.100.9",
					"cf-connecting-ip": "20.0.0.1",
				}),
			),
		).toBe("x-real-ip");
		expect(
			preferredClientIpHeader(headers({ "x-forwarded-for": "192.0.2.1" })),
		).toBe("x-forwarded-for");
	});
});

describe("resolveClientIp cloudflare-aware trust order", () => {
	it("trusts cf-connecting-ip only behind Cloudflare", () => {
		expect(
			resolveClientIp(
				headers({
					"cf-connecting-ip": "20.0.0.1",
					"x-real-ip": "192.0.2.30",
				}),
			),
		).toBe("192.0.2.30");
		expect(
			resolveClientIp(
				headers({
					"cf-connecting-ip": "20.0.0.1",
					"cf-ray": "abc-FRA",
					"x-real-ip": "192.0.2.30",
				}),
			),
		).toBe("20.0.0.1");
	});

	it("drops client spoofed cf-connecting-ip when not proxied", () => {
		expect(resolveClientIp(headers({ "cf-connecting-ip": "20.0.0.1" }))).toBe(
			"0.0.0.0",
		);
		expect(
			resolveClientIp(
				headers({
					"cf-connecting-ip": "20.0.0.1",
					"x-forwarded-for": "192.0.2.10",
				}),
			),
		).toBe("192.0.2.10");
	});

	it("keeps normalized IPv6 and fallbacks identical to the audited resolver", () => {
		expect(
			resolveClientIp(
				headers({
					"cf-connecting-ip": "2001:DB8:0:0::1",
					"cf-ray": "abc-FRA",
					"x-forwarded-for": "192.0.2.10",
				}),
			),
		).toBe("2001:db8::1");
		expect(
			resolveClientIp(
				headers({
					"cf-connecting-ip": "",
					"x-forwarded-for": "malformed, 192.0.2.10",
					"x-real-ip": "192.0.2.30",
				}),
			),
		).toBe("192.0.2.30");
	});
});
