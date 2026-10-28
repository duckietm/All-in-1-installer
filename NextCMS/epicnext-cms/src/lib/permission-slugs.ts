// ── Permission Slug Constants ───────────────────────────────────────
// Extracted to its own file so it can be imported by client components
// (modules.ts → sidebar.tsx) without pulling in db/server-only deps.

export const PERMS = {
	HOUSEKEEPING_PREVIEW_ACCESS: "housekeeping.preview.access",
	ADMIN_DASHBOARD: "admin.dashboard",
	USERS_VIEW: "admin.users.view",
	USERS_EDIT: "admin.users.edit",
	USERS_BAN: "admin.users.ban",
	USERS_RESET_PASSWORD: "admin.users.reset_password",
	ROOMS_VIEW: "admin.room.view",
	ROOMS_EDIT: "admin.room.edit",
	ROOMS_DELETE: "admin.room.delete",
	BANS_VIEW: "admin.bans.view",
	NEWS_VIEW: "admin.news.view",
	NEWS_EDIT: "admin.news.edit",
	LOGS_VIEW: "admin.logs.view",
	SETTINGS_VIEW: "admin.settings.view",
	SETTINGS_EDIT: "admin.settings.edit",
	PERMISSIONS_MANAGE: "admin.permissions.manage",
	SHOP_VIEW: "admin.shop.view",
	SHOP_EDIT: "admin.shop.edit",
	WORDFILTER_VIEW: "admin.wordfilter.view",
	WORDFILTER_EDIT: "admin.wordfilter.edit",
	CATALOG_VIEW: "admin.catalog.view",
	CATALOG_EDIT: "admin.catalog.edit",
	RCON_EXECUTE: "admin.rcon.execute",
	EXPORT: "admin.export",
	// ── Radio Module ──
	RADIO_VIEW: "admin.radio.view",
	RADIO_EDIT: "admin.radio.edit",
	PREFIXES_VIEW: "admin.prefixes.view",
	PREFIXES_EDIT: "admin.prefixes.edit",
	TICKETS_VIEW: "admin.tickets.view",
	TICKETS_EDIT: "admin.tickets.edit",
	MODERATION_VIEW: "admin.moderation.view",
	MODERATION_EDIT: "admin.moderation.edit",
	// ── Events Module ──
	EVENTS_VIEW: "admin.events.view",
	EVENTS_EDIT: "admin.events.edit",
	// ── Analytics Module ──
	ANALYTICS_VIEW: "admin.analytics.view",
	ANALYTICS_EXPORT: "admin.analytics.export",
	// ── DevOps Module ──
	DEVOPS_VIEW: "admin.devops.view",
	DEVOPS_EDIT: "admin.devops.edit",
	// ── Polls Module ──
	POLLS_VIEW: "admin.polls.view",
	POLLS_EDIT: "admin.polls.edit",
	// ── Referrals Module ──
	REFERRALS_VIEW: "admin.referrals.view",
	REFERRALS_EDIT: "admin.referrals.edit",
	// ── Daily Login Rewards Module ──
	DAILY_REWARDS_VIEW: "admin.dailyrewards.view",
	DAILY_REWARDS_EDIT: "admin.dailyrewards.edit",
	// ── Notifications Module ──
	NOTIFICATIONS_VIEW: "admin.notifications.view",
	NOTIFICATIONS_EDIT: "admin.notifications.edit",
	// ── CMS Pages Module ──
	PAGES_VIEW: "admin.pages.view",
	PAGES_EDIT: "admin.pages.edit",
	// ── Banners Module ──
	BANNERS_VIEW: "admin.banners.view",
	BANNERS_EDIT: "admin.banners.edit",
	// ── Assets Module ──
	ASSETS_IMPORT: "admin.assets.import",
	// ── Mod Panel Permissions ──
	MOD_DASHBOARD: "mod.dashboard",
	MOD_CFH_VIEW: "mod.cfh.view",
	MOD_CFH_EDIT: "mod.cfh.edit",
	MOD_ACTIONS: "mod.actions",
	MOD_TEAM_VIEW: "mod.team.view",
	MOD_TICKETS_VIEW: "mod.tickets.view",
	MOD_TICKETS_EDIT: "mod.tickets.edit",
	MOD_USERS_VIEW: "mod.users.view",
	MOD_BANS_VIEW: "mod.bans.view",
} as const;
