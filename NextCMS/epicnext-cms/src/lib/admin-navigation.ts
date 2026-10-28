import {
	Activity,
	Cog,
	LayoutDashboard,
	Newspaper,
	Package,
	ShoppingCart,
	Users,
	UsersRound,
} from "lucide-react";
import {
	ADMIN_NAV_GROUPS,
	type AdminNavGroup,
	navItemIsAllowed,
} from "@/lib/admin-nav";
import {
	type AdminNavConfig,
	applyAdminNavConfig,
} from "@/lib/admin-nav-config";

export type AdminNavigationOptions = {
	allowedPermissions: string[];
	isSuperAdmin: boolean;
	navConfig: AdminNavConfig;
};
const sections = [
	{ labelKey: "overview", icon: LayoutDashboard, roots: [""] },
	{
		labelKey: "peopleSupport",
		icon: Users,
		roots: [
			"users",
			"online",
			"tickets",
			"help-tickets",
			"bans",
			"ip",
			"vpn",
			"wordfilter",
			"moderation",
			"rooms",
		],
	},
	{
		labelKey: "catalogFurniture",
		icon: Package,
		roots: [
			"studio",
			"catalog",
			"import",
			"items",
			"rare-values",
			"badges",
			"achievements",
			"sounds",
		],
	},
	{
		labelKey: "communityContent",
		icon: Newspaper,
		roots: [
			"articles",
			"photos",
			"events",
			"polls",
			"guilds",
			"media",
			"radio",
			"ads",
			"banners",
			"navigation",
			"help-questions",
			"writeable-boxes",
			"tags",
			"prefixes",
		],
	},
	{
		labelKey: "economy",
		icon: ShoppingCart,
		roots: [
			"shop",
			"marketplace",
			"transactions",
			"vouchers",
			"subscriptions",
			"calendar",
		],
	},
	{
		labelKey: "staffPermissions",
		icon: UsersRound,
		roots: ["teams", "applications", "permissions"],
	},
	{
		labelKey: "system",
		icon: Cog,
		roots: [
			"settings",
			"theme",
			"theme-builder",
			"maintenance",
			"favicon",
			"email-templates",
			"translations",
			"emulator",
			"housekeeping",
			"commandocentrum",
		],
	},
	{
		labelKey: "monitoring",
		icon: Activity,
		roots: ["logs", "analytics", "devops", "alerts"],
	},
];

/** Owner order takes precedence; hidden entries are filtered before regrouping. */
export function visibleAdminNavigation(
	options: AdminNavigationOptions,
): AdminNavGroup[] {
	const allowed = new Set(options.allowedPermissions);
	const groups = applyAdminNavConfig(ADMIN_NAV_GROUPS, options.navConfig)
		.map((group) => ({
			...group,
			items: group.items.filter((item) =>
				navItemIsAllowed(item, {
					isSuperAdmin: options.isSuperAdmin,
					has: (slug) => allowed.has(slug),
				}),
			),
		}))
		.filter((group) => group.items.length);
	if (
		options.navConfig.groupOrder?.length ||
		Object.values(options.navConfig.itemOrder ?? {}).some(
			(order) => order.length,
		)
	)
		return groups;
	const remaining = new Map(
		groups.flatMap((group) => group.items).map((item) => [item.href, item]),
	);
	const organized = sections
		.map((section) => {
			const items = [...remaining.values()].filter((item) =>
				section.roots.includes(item.href.split("/")[2] ?? ""),
			);
			for (const item of items) remaining.delete(item.href);
			return { labelKey: section.labelKey, icon: section.icon, items };
		})
		.filter((group) => group.items.length);
	// New routes remain discoverable even before being assigned to an activity.
	if (remaining.size)
		organized.push({
			labelKey: "tools",
			icon: Cog,
			items: [...remaining.values()],
		});
	return organized;
}
