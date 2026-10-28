import { apiJson } from "@/lib/api";
import { siteSettings } from "@/lib/services/site-settings";

// Public website settings as a flat { key: value } map. Secrets are stripped so
// this can be served to the game client / external integrations.

// Any key containing one of these tokens is considered sensitive and never
// exposed through the public API (mirrors AtomCMS's public settings filtering).
const SENSITIVE = ["secret", "api_key", "password", "token", "webhook"];

function isSensitive(key: string): boolean {
	const k = key.toLowerCase();
	return SENSITIVE.some((needle) => k.includes(needle));
}

export async function GET(_req: Request) {
	try {
		const map = await siteSettings.getAll();
		const settings: Record<string, string> = {};
		for (const [key, value] of map) {
			if (!isSensitive(key)) settings[key] = value;
		}
		return apiJson(settings);
	} catch {
		return apiJson({}, { status: 200 });
	}
}
