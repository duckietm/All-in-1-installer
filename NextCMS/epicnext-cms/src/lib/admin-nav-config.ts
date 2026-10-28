import type { AdminNavGroup } from "@/lib/admin-nav";

/** website_settings key storing JSON overlay for the admin sidebar. */
export const ADMIN_NAV_CONFIG_KEY = "admin_nav_config";

/** Hrefs that cannot be hidden (dashboard). */
export const ADMIN_NAV_PINNED_HREFS = new Set(["/admin"]);

export type AdminNavConfig = {
	/** Group labelKeys in display order. Missing groups append in catalog order. */
	groupOrder?: string[];
	/** Group labelKeys fully hidden from the sidebar. */
	hiddenGroups?: string[];
	/** Item hrefs hidden from the sidebar (except pinned). */
	hiddenItems?: string[];
	/** Per-group item href order. Missing items append in catalog order. */
	itemOrder?: Record<string, string[]>;
};

function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Parse stored JSON; invalid / empty → empty config. */
export function parseAdminNavConfig(
	raw: string | null | undefined,
): AdminNavConfig {
	if (!raw?.trim()) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		const o = parsed as Record<string, unknown>;
		const config: AdminNavConfig = {};
		if (isStringArray(o.groupOrder)) config.groupOrder = o.groupOrder;
		if (isStringArray(o.hiddenGroups)) config.hiddenGroups = o.hiddenGroups;
		if (isStringArray(o.hiddenItems)) config.hiddenItems = o.hiddenItems;
		if (
			o.itemOrder &&
			typeof o.itemOrder === "object" &&
			!Array.isArray(o.itemOrder)
		) {
			const itemOrder: Record<string, string[]> = {};
			for (const [k, v] of Object.entries(
				o.itemOrder as Record<string, unknown>,
			)) {
				if (isStringArray(v)) itemOrder[k] = v;
			}
			config.itemOrder = itemOrder;
		}
		return config;
	} catch {
		return {};
	}
}

function orderByKeys<T>(
	items: T[],
	order: string[] | undefined,
	keyOf: (item: T) => string,
): T[] {
	if (!order?.length) return items;
	const byKey = new Map(items.map((item) => [keyOf(item), item]));
	const seen = new Set<string>();
	const out: T[] = [];
	for (const key of order) {
		const hit = byKey.get(key);
		if (!hit || seen.has(key)) continue;
		out.push(hit);
		seen.add(key);
	}
	for (const item of items) {
		const key = keyOf(item);
		if (seen.has(key)) continue;
		out.push(item);
	}
	return out;
}

/**
 * Apply owner overlay (hide + reorder) on top of the code catalog.
 * Does not apply ACL — callers filter permissions afterwards.
 */
export function applyAdminNavConfig(
	groups: AdminNavGroup[],
	config: AdminNavConfig,
): AdminNavGroup[] {
	const hiddenGroups = new Set(config.hiddenGroups ?? []);
	const hiddenItems = new Set(config.hiddenItems ?? []);

	const mapped = groups
		.filter((g) => !hiddenGroups.has(g.labelKey))
		.map((group) => {
			const items = group.items.filter((item) => {
				if (ADMIN_NAV_PINNED_HREFS.has(item.href)) return true;
				return !hiddenItems.has(item.href);
			});
			const orderedItems = orderByKeys(
				items,
				config.itemOrder?.[group.labelKey],
				(item) => item.href,
			);
			return { ...group, items: orderedItems };
		})
		.filter((group) => group.items.length > 0);

	return orderByKeys(mapped, config.groupOrder, (g) => g.labelKey);
}

export function serializeAdminNavConfig(config: AdminNavConfig): string {
	return JSON.stringify({
		groupOrder: config.groupOrder ?? [],
		hiddenGroups: config.hiddenGroups ?? [],
		hiddenItems: (config.hiddenItems ?? []).filter(
			(href) => !ADMIN_NAV_PINNED_HREFS.has(href),
		),
		itemOrder: config.itemOrder ?? {},
	});
}
