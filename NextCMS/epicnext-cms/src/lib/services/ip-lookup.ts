import { siteSettings } from "@/lib/services/site-settings";

/**
 * VPN / proxy / Tor detection via an external provider, driven by
 * website_settings (configured at /admin/vpn). Mirrors AtomCMS's IP lookup used
 * to block registrations from anonymising IPs. FAIL-OPEN: any error, missing
 * config, or disabled toggle returns "not blocked".
 *
 * Settings keys: vpn_block_enabled ("1"), vpn_provider ("proxycheck" |
 * "ipqualityscore"), vpn_api_key.
 */
export interface IpVerdict {
	blocked: boolean;
	reason?: string;
}

const PRIVATE_RE =
	/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|localhost$|0\.0\.0\.0$)/i;

export async function checkVpn(ip: string): Promise<IpVerdict> {
	if (!ip || PRIVATE_RE.test(ip)) return { blocked: false };
	if (!(await siteSettings.getBool("vpn_block_enabled", false)))
		return { blocked: false };

	const provider = (
		(await siteSettings.get("vpn_provider", "proxycheck")) ?? "proxycheck"
	).toLowerCase();
	const apiKey = (await siteSettings.get("vpn_api_key", "")) ?? "";

	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 4000);

		if (provider === "ipqualityscore") {
			if (!apiKey) return { blocked: false };
			const res = await fetch(
				`https://ipqualityscore.com/api/json/ip/${encodeURIComponent(apiKey)}/${encodeURIComponent(ip)}`,
				{ signal: controller.signal, cache: "no-store" },
			);
			clearTimeout(timer);
			const d = (await res.json()) as {
				proxy?: boolean;
				vpn?: boolean;
				tor?: boolean;
			};
			if (d?.vpn || d?.tor || d?.proxy)
				return { blocked: true, reason: "VPN/proxy detected" };
			return { blocked: false };
		}

		// Default: proxycheck.io (works keyless at a low rate; key raises limits).
		const url = `https://proxycheck.io/v2/${encodeURIComponent(ip)}?vpn=1&risk=1${apiKey ? `&key=${encodeURIComponent(apiKey)}` : ""}`;
		const res = await fetch(url, {
			signal: controller.signal,
			cache: "no-store",
		});
		clearTimeout(timer);
		const d = (await res.json()) as Record<
			string,
			{ proxy?: string; type?: string }
		>;
		// ip is the API response key from proxycheck
		const entry = d?.[ip];
		if (entry?.proxy === "yes")
			return { blocked: true, reason: `${entry.type ?? "Proxy"} detected` };
		return { blocked: false };
	} catch {
		return { blocked: false };
	}
}
