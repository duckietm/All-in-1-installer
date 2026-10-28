/**
 * Cloudflare presence detection.
 *
 * Only headers that a Cloudflare edge adds to every transit are treated as
 * proof the request passed through Cloudflare: `CF-Ray` is stamped by the
 * edge and `CDN-Loop: cloudflare` is prepended on CDN transits. A bare
 * `CF-Connecting-IP` is *not* sufficient — a direct client to the origin can
 * send that header itself — so it is only trusted in combination with one of
 * the edge-stamped fingerprints.
 */
export function isCloudflareProxied(headers: Pick<Headers, "get">): boolean {
	const ray = headers.get("cf-ray")?.trim();
	if (ray) return true;
	const loop = headers.get("cdn-loop")?.trim();
	if (loop) return true;
	return false;
}

/**
 * Which client-IP header the stack should trust for a given request. When the
 * request demonstrably transited Cloudflare, `CF-Connecting-IP` carries the
 * real client; otherwise only the ingress-set `X-Real-IP` / `X-Forwarded-For`
 * (derived by nginx from the actual TCP peer) may be trusted.
 */
export function preferredClientIpHeader(
	headers: Pick<Headers, "get">,
): "cf-connecting-ip" | "x-forwarded-for" | "x-real-ip" | "none" {
	if (isCloudflareProxied(headers)) return "cf-connecting-ip";
	if (headers.get("x-real-ip")?.trim()) return "x-real-ip";
	if (headers.get("x-forwarded-for")?.trim()) return "x-forwarded-for";
	return "none";
}
