import {
	Activity,
	AlertTriangle,
	BadgeCheck,
	Ban,
	Calendar,
	CalendarCheck,
	CalendarDays,
	ClipboardList,
	Cog,
	Compass,
	FileText,
	Filter,
	Gavel,
	Gift,
	HelpCircle,
	Image,
	KeyRound,
	Languages,
	LayoutDashboard,
	type LucideIcon,
	Megaphone,
	Monitor,
	Newspaper,
	Package,
	Palette,
	Radio,
	Server,
	Settings,
	Shield,
	ShoppingCart,
	Sparkles,
	Store,
	Tags,
	Terminal,
	Ticket,
	Trophy,
	Users,
	UsersRound,
	Volume2,
	Vote,
	Wifi,
	Wrench,
} from "lucide-react";
import { PERMS } from "@/lib/permission-slugs";

export interface AdminHubTab {
	href: string;
	/** Key under pages.admin.hubs.tabs.* */
	labelKey: string;
	match?: string[];
	/** Optional group id for multi-row tab strips (e.g. Radio primary/tools). */
	group?: string;
}

export interface AdminHubDefinition {
	id: string;
	/** Key under pages.admin.hubs.* for title/subtitle */
	titleKey: string;
	subtitleKey: string;
	icon: LucideIcon;
	/** Path prefixes belonging to this hub (for chrome + sidebar active). */
	prefixes: string[];
	tabs: AdminHubTab[];
}

export interface AdminNavItem {
	href: string;
	labelKey: string;
	icon: LucideIcon;
	/**
	 * ACL slug(s) required to show this item. Any match is enough.
	 * Omit only for the dashboard (already gated by admin.dashboard).
	 */
	permission?: string | readonly string[];
	/** When set, sidebar item is active if pathname matches any prefix. */
	matchPrefixes?: string[];
	/** Prefixes that must NOT count as active (e.g. /admin/users vs multi-accounts). */
	matchExcludePrefixes?: string[];
}

export interface AdminNavGroup {
	labelKey: string;
	icon: LucideIcon;
	items: AdminNavItem[];
}

/**
 * Hubs with real sibling tabs only. Standalone features have no hub chrome
 * (sidebar links go straight to the page).
 */
export const ADMIN_HUBS: AdminHubDefinition[] = [
	{
		id: "events",
		titleKey: "events",
		subtitleKey: "eventsSubtitle",
		icon: Calendar,
		prefixes: ["/admin/events"],
		tabs: [
			{ href: "/admin/events", labelKey: "events", match: ["/admin/events"] },
			{ href: "/admin/events/types", labelKey: "eventTypes" },
		],
	},
	{
		id: "tickets",
		titleKey: "tickets",
		subtitleKey: "ticketsSubtitle",
		icon: Ticket,
		prefixes: ["/admin/tickets", "/admin/help-tickets"],
		tabs: [
			{
				href: "/admin/tickets",
				labelKey: "ticketInbox",
				match: ["/admin/tickets"],
			},
			{
				href: "/admin/tickets/desk",
				labelKey: "tickets",
				match: ["/admin/tickets/desk"],
			},
			{
				href: "/admin/help-tickets",
				labelKey: "helpTickets",
				match: ["/admin/help-tickets"],
			},
			{ href: "/admin/tickets/templates", labelKey: "templates" },
		],
	},
	{
		id: "staff-access",
		titleKey: "staffAccess",
		subtitleKey: "staffAccessSubtitle",
		icon: KeyRound,
		prefixes: ["/admin/teams", "/admin/permissions", "/admin/housekeeping"],
		tabs: [
			{ href: "/admin/teams", labelKey: "teams" },
			{
				href: "/admin/permissions",
				labelKey: "permissions",
				match: ["/admin/permissions"],
			},
			{ href: "/admin/housekeeping", labelKey: "housekeeping" },
		],
	},
	{
		id: "moderation",
		titleKey: "moderation",
		subtitleKey: "moderationSubtitle",
		icon: Gavel,
		prefixes: ["/admin/moderation"],
		tabs: [
			{ href: "/admin/moderation", labelKey: "overview" },
			{ href: "/admin/moderation/actions", labelKey: "actions" },
			{
				href: "/admin/moderation/cfh",
				labelKey: "cfh",
				match: ["/admin/moderation/cfh"],
			},
			{ href: "/admin/moderation/team", labelKey: "team" },
		],
	},
	{
		id: "radio",
		titleKey: "radio",
		subtitleKey: "radioSubtitle",
		icon: Radio,
		prefixes: ["/admin/radio"],
		tabs: [
			{ href: "/admin/radio", labelKey: "overview", group: "primary" },
			{ href: "/admin/radio/history", labelKey: "history", group: "primary" },
			{
				href: "/admin/radio/moderation",
				labelKey: "moderationTab",
				group: "primary",
			},
			{
				href: "/admin/radio/monitoring",
				labelKey: "monitoring",
				group: "primary",
			},
			{
				href: "/admin/radio/settings",
				labelKey: "settingsTab",
				group: "primary",
			},
			{ href: "/admin/radio/banners", labelKey: "banners", group: "tools" },
			{ href: "/admin/radio/embed", labelKey: "embed", group: "tools" },
			{ href: "/admin/radio/api-keys", labelKey: "apiKeys", group: "tools" },
			{ href: "/admin/radio/points", labelKey: "points", group: "tools" },
			{ href: "/admin/radio/ranks", labelKey: "ranks", group: "tools" },
			{ href: "/admin/radio/autodj", labelKey: "autoDj", group: "tools" },
		],
	},
	{
		id: "analytics",
		titleKey: "analytics",
		subtitleKey: "analyticsSubtitle",
		icon: Activity,
		prefixes: ["/admin/analytics"],
		tabs: [
			{
				href: "/admin/analytics",
				labelKey: "analytics",
				match: ["/admin/analytics"],
			},
			{ href: "/admin/analytics/activity", labelKey: "activity" },
			{ href: "/admin/analytics/economy", labelKey: "economy" },
		],
	},
	{
		id: "devops",
		titleKey: "devops",
		subtitleKey: "devopsSubtitle",
		icon: Server,
		prefixes: ["/admin/devops"],
		tabs: [
			{
				href: "/admin/devops",
				labelKey: "devops",
				match: ["/admin/devops"],
			},
			{ href: "/admin/devops/errors", labelKey: "errors" },
			{ href: "/admin/devops/cms-errors", labelKey: "cmsErrors" },
		],
	},
];

/** Longest-prefix match so nested routes (e.g. /admin/logs/audit) win. */
export function findAdminHub(pathname: string): AdminHubDefinition | null {
	let best: AdminHubDefinition | null = null;
	let bestLen = -1;
	for (const hub of ADMIN_HUBS) {
		for (const prefix of hub.prefixes) {
			const hit = pathname === prefix || pathname.startsWith(`${prefix}/`);
			if (hit && prefix.length > bestLen) {
				best = hub;
				bestLen = prefix.length;
			}
		}
	}
	return best;
}

/** Feature-first sidebar: one entry per feature; hubs only for sibling tabs. */
export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
	{
		labelKey: "overview",
		icon: LayoutDashboard,
		items: [
			{
				href: "/admin",
				labelKey: "dashboard",
				icon: LayoutDashboard,
				permission: PERMS.ADMIN_DASHBOARD,
			},
			{
				href: "/admin/operations",
				labelKey: "operationsCenter",
				icon: Activity,
				permission: PERMS.ASSETS_IMPORT,
			},
		],
	},
	{
		labelKey: "content",
		icon: Newspaper,
		items: [
			{
				href: "/admin/articles",
				labelKey: "articles",
				icon: Newspaper,
				permission: PERMS.NEWS_VIEW,
				matchPrefixes: ["/admin/articles"],
			},
			{
				href: "/admin/photos",
				labelKey: "photos",
				icon: Image,
				permission: PERMS.PAGES_VIEW,
			},
			{
				href: "/admin/banners",
				labelKey: "banners",
				icon: Megaphone,
				permission: PERMS.BANNERS_VIEW,
			},
			{
				href: "/admin/ads",
				labelKey: "advertisements",
				icon: FileText,
				permission: PERMS.PAGES_VIEW,
				matchPrefixes: ["/admin/ads"],
			},
			{
				href: "/admin/media",
				labelKey: "media",
				icon: Image,
				permission: PERMS.PAGES_VIEW,
			},
			{
				href: "/admin/navigation",
				labelKey: "navigator",
				icon: Compass,
				permission: PERMS.PAGES_VIEW,
			},
			{
				href: "/admin/help-questions",
				labelKey: "helpCenter",
				icon: HelpCircle,
				permission: PERMS.PAGES_VIEW,
				matchPrefixes: ["/admin/help-questions"],
			},
			{
				href: "/admin/writeable-boxes",
				labelKey: "writeableBoxes",
				icon: Package,
				permission: PERMS.PAGES_VIEW,
			},
			{
				href: "/admin/tags",
				labelKey: "tags",
				icon: Tags,
				permission: PERMS.PAGES_VIEW,
			},
			{
				href: "/admin/prefixes",
				labelKey: "prefixes",
				icon: Sparkles,
				permission: PERMS.PREFIXES_VIEW,
			},
		],
	},
	{
		labelKey: "community",
		icon: Calendar,
		items: [
			{
				href: "/admin/events",
				labelKey: "events",
				icon: Calendar,
				permission: PERMS.EVENTS_VIEW,
				matchPrefixes: ["/admin/events"],
			},
			{
				href: "/admin/polls",
				labelKey: "polls",
				icon: Vote,
				permission: PERMS.POLLS_VIEW,
				matchPrefixes: ["/admin/polls"],
			},
			{
				href: "/admin/guilds",
				labelKey: "guilds",
				icon: UsersRound,
				permission: PERMS.USERS_VIEW,
				matchPrefixes: ["/admin/guilds"],
			},
			{
				href: "/admin/tickets",
				labelKey: "tickets",
				icon: Ticket,
				permission: PERMS.TICKETS_VIEW,
				matchPrefixes: ["/admin/tickets", "/admin/help-tickets"],
			},
		],
	},
	{
		labelKey: "usersAndAccess",
		icon: Users,
		items: [
			{
				href: "/admin/users",
				labelKey: "users",
				icon: Users,
				permission: PERMS.USERS_VIEW,
				matchPrefixes: ["/admin/users"],
				matchExcludePrefixes: ["/admin/users/multi-accounts"],
			},
			{
				href: "/admin/users/multi-accounts",
				labelKey: "multiAccounts",
				icon: Users,
				permission: PERMS.USERS_VIEW,
			},
			{
				href: "/admin/online",
				labelKey: "onlineUsers",
				icon: Wifi,
				permission: PERMS.USERS_VIEW,
			},
			{
				href: "/admin/applications",
				labelKey: "applications",
				icon: ClipboardList,
				permission: PERMS.USERS_VIEW,
			},
			{
				href: "/admin/teams",
				labelKey: "staffAccess",
				icon: KeyRound,
				permission: [
					PERMS.USERS_VIEW,
					PERMS.PERMISSIONS_MANAGE,
					PERMS.SETTINGS_VIEW,
				],
				matchPrefixes: [
					"/admin/teams",
					"/admin/permissions",
					"/admin/housekeeping",
				],
			},
			{
				href: "/admin/bans",
				labelKey: "bans",
				icon: Ban,
				permission: PERMS.BANS_VIEW,
			},
			{
				href: "/admin/ip",
				labelKey: "ipManagement",
				icon: Shield,
				permission: PERMS.SETTINGS_VIEW,
			},
			{
				href: "/admin/vpn",
				labelKey: "vpn",
				icon: Shield,
				permission: PERMS.SETTINGS_VIEW,
			},
			{
				href: "/admin/wordfilter",
				labelKey: "wordFilter",
				icon: Filter,
				permission: PERMS.WORDFILTER_VIEW,
			},
			{
				href: "/admin/moderation",
				labelKey: "moderation",
				icon: Gavel,
				permission: PERMS.MODERATION_VIEW,
				matchPrefixes: ["/admin/moderation"],
			},
		],
	},
	{
		labelKey: "economy",
		icon: ShoppingCart,
		items: [
			{
				href: "/admin/catalog",
				labelKey: "catalog",
				icon: Store,
				permission: PERMS.CATALOG_VIEW,
				matchPrefixes: ["/admin/catalog"],
			},
			{
				href: "/admin/studio/maintenance",
				labelKey: "catalogMaintenance",
				icon: Wrench,
				permission: PERMS.CATALOG_EDIT,
				matchPrefixes: ["/admin/studio/maintenance"],
			},
			{
				href: "/admin/items",
				labelKey: "itemsBase",
				icon: Package,
				permission: PERMS.CATALOG_VIEW,
				matchPrefixes: ["/admin/items"],
			},
			{
				href: "/admin/rare-values",
				labelKey: "rareValues",
				icon: Sparkles,
				permission: PERMS.SHOP_VIEW,
			},
			{
				href: "/admin/badges",
				labelKey: "badges",
				icon: BadgeCheck,
				permission: PERMS.CATALOG_VIEW,
			},
			{
				href: "/admin/achievements",
				labelKey: "achievements",
				icon: Trophy,
				permission: PERMS.CATALOG_VIEW,
			},
			{
				href: "/admin/sounds",
				labelKey: "sounds",
				icon: Volume2,
				permission: PERMS.CATALOG_VIEW,
			},
			{
				href: "/admin/shop",
				labelKey: "shop",
				icon: ShoppingCart,
				permission: PERMS.SHOP_VIEW,
			},
			{
				href: "/admin/marketplace",
				labelKey: "marketplace",
				icon: Store,
				permission: PERMS.SHOP_VIEW,
			},
			{
				href: "/admin/transactions",
				labelKey: "transactions",
				icon: Activity,
				permission: PERMS.SHOP_VIEW,
			},
			{
				href: "/admin/vouchers",
				labelKey: "vouchers",
				icon: Ticket,
				permission: PERMS.SHOP_VIEW,
			},
			{
				href: "/admin/subscriptions",
				labelKey: "subscriptions",
				icon: ClipboardList,
				permission: PERMS.SHOP_VIEW,
			},
			{
				href: "/admin/calendar",
				labelKey: "calendar",
				icon: CalendarDays,
				permission: PERMS.SHOP_VIEW,
				matchPrefixes: ["/admin/calendar"],
			},
			{
				href: "/admin/referrals",
				labelKey: "referrals",
				icon: Gift,
				permission: PERMS.REFERRALS_VIEW,
				matchPrefixes: ["/admin/referrals"],
			},
			{
				href: "/admin/daily-rewards",
				labelKey: "dailyRewards",
				icon: CalendarCheck,
				permission: PERMS.DAILY_REWARDS_VIEW,
				matchPrefixes: ["/admin/daily-rewards"],
			},
		],
	},
	{
		labelKey: "radio",
		icon: Radio,
		items: [
			{
				href: "/admin/radio",
				labelKey: "radio",
				icon: Radio,
				permission: PERMS.RADIO_VIEW,
				matchPrefixes: ["/admin/radio"],
			},
		],
	},
	{
		labelKey: "system",
		icon: Settings,
		items: [
			{
				href: "/admin/settings",
				labelKey: "settings",
				icon: Cog,
				permission: PERMS.SETTINGS_VIEW,
			},
			{
				href: "/admin/theme",
				labelKey: "theme",
				icon: Sparkles,
				permission: PERMS.SETTINGS_VIEW,
			},
			{
				href: "/admin/theme-builder",
				labelKey: "themeBuilder",
				icon: Palette,
				permission: PERMS.SETTINGS_VIEW,
			},
			{
				href: "/admin/maintenance",
				labelKey: "maintenance",
				icon: Wrench,
				permission: PERMS.SETTINGS_VIEW,
			},
			{
				href: "/admin/favicon",
				labelKey: "favicon",
				icon: Image,
				permission: PERMS.SETTINGS_VIEW,
			},
			{
				href: "/admin/emulator",
				labelKey: "emulator",
				icon: Server,
				permission: PERMS.SETTINGS_VIEW,
			},
			{
				href: "/admin/email-templates",
				labelKey: "emailTemplates",
				icon: FileText,
				permission: PERMS.PAGES_VIEW,
			},
		],
	},
	{
		labelKey: "tools",
		icon: Wrench,
		items: [
			{
				href: "/admin/commandocentrum",
				labelKey: "commandocentrum",
				icon: Terminal,
				permission: PERMS.RCON_EXECUTE,
			},
			{
				href: "/admin/rooms",
				labelKey: "rooms",
				icon: Store,
				permission: PERMS.ROOMS_VIEW,
				matchPrefixes: ["/admin/rooms"],
			},
			{
				href: "/admin/studio",
				labelKey: "studio",
				icon: Palette,
				permission: PERMS.ASSETS_IMPORT,
				matchPrefixes: ["/admin/studio"],
			},
			{
				href: "/admin/translations",
				labelKey: "translations",
				icon: Languages,
				permission: PERMS.SETTINGS_VIEW,
				matchPrefixes: ["/admin/translations"],
			},
		],
	},
	{
		labelKey: "monitoring",
		icon: Monitor,
		items: [
			{
				href: "/admin/logs",
				labelKey: "logs",
				icon: FileText,
				permission: PERMS.LOGS_VIEW,
				matchPrefixes: ["/admin/logs"],
				matchExcludePrefixes: [
					"/admin/logs/audit",
					"/admin/logs/chat",
					"/admin/logs/commands",
					"/admin/logs/trades",
				],
			},
			{
				href: "/admin/logs/audit",
				labelKey: "auditLog",
				icon: ClipboardList,
				permission: PERMS.LOGS_VIEW,
			},
			{
				href: "/admin/logs/chat",
				labelKey: "chatLog",
				icon: FileText,
				permission: PERMS.LOGS_VIEW,
			},
			{
				href: "/admin/logs/commands",
				labelKey: "commandLog",
				icon: Terminal,
				permission: PERMS.LOGS_VIEW,
			},
			{
				href: "/admin/logs/trades",
				labelKey: "tradeLog",
				icon: Activity,
				permission: PERMS.LOGS_VIEW,
			},
			{
				href: "/admin/analytics",
				labelKey: "analytics",
				icon: Activity,
				permission: PERMS.ANALYTICS_VIEW,
				matchPrefixes: ["/admin/analytics"],
			},
			{
				href: "/admin/devops",
				labelKey: "devops",
				icon: Server,
				permission: PERMS.DEVOPS_VIEW,
				matchPrefixes: ["/admin/devops"],
				matchExcludePrefixes: ["/admin/devops/cms-errors"],
			},
			{
				href: "/admin/devops/cms-errors",
				labelKey: "cmsErrors",
				icon: AlertTriangle,
				permission: PERMS.DEVOPS_VIEW,
			},
			{
				href: "/admin/alerts",
				labelKey: "alerts",
				icon: AlertTriangle,
				permission: PERMS.NOTIFICATIONS_VIEW,
			},
		],
	},
];

/** Whether a nav item should be visible for the given permission set. */
export function navItemIsAllowed(
	item: AdminNavItem,
	opts: { isSuperAdmin: boolean; has: (slug: string) => boolean },
): boolean {
	if (opts.isSuperAdmin) return true;
	if (!item.permission) return true;
	const needed = Array.isArray(item.permission)
		? item.permission
		: [item.permission];
	return needed.some((slug) => opts.has(slug));
}

/** Collect every ACL slug referenced by the sidebar (for layout gating). */
export function collectNavPermissionSlugs(): string[] {
	const slugs = new Set<string>();
	for (const group of ADMIN_NAV_GROUPS) {
		for (const item of group.items) {
			if (!item.permission) continue;
			const needed = Array.isArray(item.permission)
				? item.permission
				: [item.permission];
			for (const slug of needed) slugs.add(slug);
		}
	}
	return [...slugs];
}
