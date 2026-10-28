"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/admin/guard";
import { db, WebsiteSetting } from "@/lib/db";
import { PERMS } from "@/lib/permissions";
import { siteSettings } from "@/lib/services/site-settings";
import { logStaffActivity } from "@/lib/services/staff-activity";

// VPN / proxy detection config. Stored as website_settings key/value rows
// (CMS-owned, BigInt id). Booleans use the strings "0" / "1", faithful to
// AtomCMS's setting() convention. This is registration-time protection only;
// the raw IP allow/deny list lives under /admin/ip (website_ip_*).

const ALLOWED_PROVIDERS = new Set(["none", "proxycheck", "ipqualityscore"]);

/** Upsert one website_settings key with a stable housekeeping comment. */
async function writeSetting(
	key: string,
	value: string,
	comment: string,
): Promise<void> {
	await db
		.insert(WebsiteSetting)
		.values({ key, value, comment })
		.onDuplicateKeyUpdate({ set: { value } });
}

export async function saveVpn(formData: FormData): Promise<void> {
	const staff = await requirePermission(PERMS.SETTINGS_EDIT);

	// Toggle: an unchecked checkbox submits nothing, so absence === disabled.
	const enabled =
		String(formData.get("vpn_block_enabled") ?? "")
			.normalize("NFC")
			.trim() !== "";

	const providerRaw = String(formData.get("vpn_provider") ?? "")
		.normalize("NFC")
		.trim()
		.toLowerCase();
	const provider = ALLOWED_PROVIDERS.has(providerRaw) ? providerRaw : "none";

	const apiKey = String(formData.get("vpn_api_key") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);
	const blockMessage = String(formData.get("vpn_block_message") ?? "")
		.normalize("NFC")
		.trim()
		.slice(0, 255);

	try {
		await writeSetting(
			"vpn_block_enabled",
			enabled ? "1" : "0",
			"Block registrations from detected VPN/proxy IPs (0=no, 1=yes)",
		);
		await writeSetting(
			"vpn_provider",
			provider,
			"VPN/proxy detection provider (none/proxycheck/ipqualityscore)",
		);
		await writeSetting(
			"vpn_api_key",
			apiKey,
			"API key for the VPN/proxy detection provider",
		);
		await writeSetting(
			"vpn_block_message",
			blockMessage,
			"Message shown to users blocked for using a VPN/proxy",
		);

		siteSettings.reload();
		await logStaffActivity({
			staffId: staff.id,
			action: "vpn_update",
			description: `Updated VPN/proxy detection (block=${enabled ? "on" : "off"}, provider=${provider})`,
		});
		revalidatePath("/admin/vpn");
	} catch {
		// DB unavailable — fail soft so the action does not throw; the page
		// re-renders the current (stored) state.
	}

	redirect("/admin/vpn?saved=1");
}
