import { isIP } from "node:net";
import { isCloudflareProxied } from "@/lib/cloudflare";

export const UNKNOWN_CLIENT_IP = "0.0.0.0";

/** Accept bare addresses only, so ports, hostnames and zone IDs cannot become keys. */
export function normalizeClientIp(
	value: string | null | undefined,
): string | null {
	const address = value?.trim();
	if (!address || address.length > 45 || address.includes("%")) return null;
	const version = isIP(address);
	if (version === 4) return address;
	if (version !== 6) return null;
	const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
	// Treat an IPv4-mapped IPv6 address as the same client as its dotted form.
	const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(canonical);
	if (mapped) {
		const high = Number.parseInt(mapped[1], 16);
		const low = Number.parseInt(mapped[2], 16);
		return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
	}
	return canonical;
}

/**
 * Forwarded headers must be overwritten by a trusted ingress and the origin must
 * reject direct public access. Header syntax alone cannot establish peer trust.
 * Never consume x-real-client-ip: API routes bypass the proxy that once set it.
 *
 * Trust order is Cloudflare-aware: only when a request demonstrably arrived via
 * Cloudflare (CF-Connecting-IP / CF-Ray / CDN-Loop) is `CF-Connecting-IP` used.
 * Otherwise the client-supplied CF header is ignored and only the ingress-set
 * `X-Real-IP` (`$remote_addr`) / `X-Forwarded-For` are trusted, so a DDoS that
 * hits the origin directly cannot re-key itself behind a spoofed header.
 */
export function resolveClientIp(headers: Pick<Headers, "get">): string {
	const cf = normalizeClientIp(headers.get("cf-connecting-ip"));
	if (isCloudflareProxied(headers)) {
		return (
			cf ??
			normalizeClientIp(headers.get("x-forwarded-for")?.split(",", 1)[0]) ??
			normalizeClientIp(headers.get("x-real-ip")) ??
			UNKNOWN_CLIENT_IP
		);
	}
	return (
		normalizeClientIp(headers.get("x-real-ip")) ??
		normalizeClientIp(headers.get("x-forwarded-for")?.split(",", 1)[0]) ??
		UNKNOWN_CLIENT_IP
	);
}
