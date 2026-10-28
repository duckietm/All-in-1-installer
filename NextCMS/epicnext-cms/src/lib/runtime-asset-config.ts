import "server-only";

// Dynamic lookup keeps legacy NEXT_PUBLIC aliases out of build-time inlining.
function setting(name: string): string | undefined {
	return process.env[name]?.trim() || undefined;
}

export function resolveImagerBase(origin?: string): string {
	const base =
		setting("IMAGER_URL") ||
		setting("NEXT_PUBLIC_IMAGER_URL") ||
		setting("IMAGING_UPSTREAM_URL") ||
		"https://www.habbo.com/habbo-imaging/avatarimage";
	const target = new URL(base, origin);
	const ownOrigins = new Set([origin]);
	const appUrl = setting("APP_URL");
	if (appUrl) ownOrigins.add(new URL(appUrl).origin);
	if (!["http:", "https:"].includes(target.protocol))
		throw new Error("Invalid imager URL protocol");
	if (
		ownOrigins.has(target.origin) &&
		["/imaging", "/api/imaging/avatar"].includes(
			target.pathname.replace(/\/+$/, ""),
		)
	) {
		const upstream = setting("IMAGING_UPSTREAM_URL");
		if (!upstream)
			throw new Error(
				"IMAGING_UPSTREAM_URL is required when the imager points to the CMS proxy",
			);
		const resolved = new URL(upstream);
		if (
			!["http:", "https:"].includes(resolved.protocol) ||
			(ownOrigins.has(resolved.origin) &&
				["/imaging", "/api/imaging/avatar"].includes(
					resolved.pathname.replace(/\/+$/, ""),
				))
		)
			throw new Error("Imager configuration creates a proxy loop");
		return resolved.href.replace(/\/+$/, "");
	}
	return target.href.replace(/\/+$/, "");
}

export function resolveBadgeBase(): string | undefined {
	return setting("BADGE_URL") || setting("NEXT_PUBLIC_BADGE_URL");
}
