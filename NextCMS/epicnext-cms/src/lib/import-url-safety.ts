import { lookup } from "node:dns/promises";

function isPrivateIpv4(hex: string): boolean {
	const parts = hex.split(".").map((p) => Number(p));
	if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
	const [a, b] = parts;
	if (a === 0 || a === 10) return true;
	if (a === 127 || a === 255) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	if (a === 192 && b === 0 && parts[2] === 0 && parts[3] === 0) return true;
	// Benchmarking (198.18/15), multicast and reserved (224/4 and up).
	if (a === 198 && (b === 18 || b === 19)) return true;
	if (a >= 224) return true;
	return false;
}

function isPrivateIpv6(addr: string): boolean {
	const lower = addr.toLowerCase();
	if (lower.startsWith("::") || lower === "::1") return true;
	if (/^fe[89ab]/.test(lower) || /^fc|^fd/.test(lower)) return true;
	if (lower.includes(":") && lower.split(":").length === 4) return false;
	if (/^2001:0?db8/.test(lower)) return true;
	return lower === "::" || lower.endsWith(":ffff:");
}

function isPrivateIp(ip: string): boolean {
	return ip.includes(":") ? isPrivateIpv6(ip) : isPrivateIpv4(ip);
}

const BLOCKED_HOST_LABELS =
	/^(localhost|.*\.local|.*\.localhost|.*\.internal|.*\.localdomain|.*\.lan)$/i;

/**
 * Guard a remote asset URL before it is stored or fetched. Rejects anything
 * that could reach the host itself: non-https, embedded credentials, private
 * IP literals, loopback/local-only hostnames and any host that resolves to a
 * private or loopback address. Throws TypeError with a human message so admin
 * routes can surface it as a 400.
 */
export async function assertSafeImportUrl(
	url: string,
	label: string,
	options: { allowHttp?: boolean } = {},
): Promise<void> {
	const trimmed = url.trim();
	if (!trimmed) return;
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new TypeError(`${label} is not a valid URL`);
	}
	if (
		parsed.protocol !== "https:" &&
		!(options.allowHttp && parsed.protocol === "http:")
	) {
		throw new TypeError(
			options.allowHttp
				? `${label} must be an http:// or https:// URL`
				: `${label} must be an https:// URL`,
		);
	}
	if (parsed.username || parsed.password) {
		throw new TypeError(`${label} must not embed credentials`);
	}
	const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
	if (BLOCKED_HOST_LABELS.test(hostname)) {
		throw new TypeError(`${label} points at a local host`);
	}
	if (hostname) {
		const looksLiteral =
			hostname.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
		if (looksLiteral) {
			if (isPrivateIp(hostname.toLowerCase())) {
				throw new TypeError(`${label} points at a private address`);
			}
			return;
		}
		let addresses: string[];
		try {
			const result = await lookup(hostname, { all: true, verbatim: true });
			addresses = result.map((r) => r.address);
		} catch {
			throw new TypeError(`${label} does not resolve to a public host`);
		}
		if (addresses.some((ip) => isPrivateIp(ip.toLowerCase()))) {
			throw new TypeError(`${label} resolves to a private address`);
		}
	}
}

/**
 * The same checks as `assertSafeImportUrl`, as a yes/no for fetches made at request time
 * (the stored URL may predate the check). Fetch with `redirect: "manual"` too, so a public
 * host cannot redirect the request to a private one.
 */
export async function isSafeOutboundUrl(
	url: string,
	options: { allowHttp?: boolean } = {},
): Promise<boolean> {
	if (!url.trim()) return false;
	try {
		await assertSafeImportUrl(url, "URL", options);
		return true;
	} catch {
		return false;
	}
}
