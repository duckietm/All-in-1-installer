// Module detection: maps route path prefixes to module IDs.
// Used by the theme resolver to apply module-scoped themes.

export const MODULE_MAP: Record<string, string> = {
	"/shop": "shop",
	"/marketplace": "marketplace",
	"/rares": "rares",
	"/guilds": "guilds",
	"/radio": "radio",
	"/news": "news",
	"/help": "help",
	"/events": "events",
	"/photos": "photos",
	"/badges": "badges",
	"/rankings": "rankings",
	"/leaderboard": "leaderboard",
	"/community": "community",
	"/staff": "staff",
	"/settings": "settings",
	"/messages": "messages",
	"/friends": "friends",
	"/apply": "apply",
	"/developers": "developers",
};

/**
 * Detect the module ID for a given pathname.
 * Returns the longest matching prefix to avoid false positives.
 */
export function detectModule(pathname: string): string | null {
	// Sort by key length descending so longest prefix wins
	const sortedKeys = Object.keys(MODULE_MAP).sort(
		(a, b) => b.length - a.length,
	);
	for (const prefix of sortedKeys) {
		if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
			return MODULE_MAP[prefix];
		}
	}
	return null;
}

/**
 * All registered module IDs (for admin UI dropdown).
 */
export function allModuleIds(): string[] {
	return [...new Set(Object.values(MODULE_MAP))].sort();
}
