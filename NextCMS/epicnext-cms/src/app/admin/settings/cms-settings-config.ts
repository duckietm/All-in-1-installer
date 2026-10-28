import { HABBO_GAMEDATA_HOTELS } from "@/lib/habbo-gamedata-hotel";

export type FieldType =
	| "text"
	| "password"
	| "url"
	| "number"
	| "boolean"
	| "textarea"
	| "select";

export type SettingsGroupIcon =
	| "building"
	| "image"
	| "gamepad"
	| "music"
	| "shield"
	| "link"
	| "user-plus";

export interface ManagedField {
	key: string;
	label: string;
	description?: string;
	type?: FieldType;
	placeholder?: string;
	defaultValue?: string;
	options?: Array<{ value: string; label: string }>;
}

export interface SettingsGroup {
	id: string;
	title: string;
	icon: SettingsGroupIcon;
	description?: string;
	fields: ManagedField[];
}

/** Keys managed by the structured CMS Settings form (not theme / VPN / maintenance pages). */
export const SETTINGS_GROUPS: SettingsGroup[] = [
	{
		id: "identity",
		title: "Hotel identity",
		icon: "building",
		description: "Name, branding and defaults shown across the site.",
		fields: [
			{
				key: "cms_logo",
				label: "Logo URL",
				description: "Header logo path or absolute URL.",
				type: "url",
				placeholder: "/api/media/logo/…",
			},
			{
				key: "cms_favicon",
				label: "Favicon URL",
				type: "url",
				placeholder: "/favicon.svg",
			},
			{
				key: "cms_header",
				label: "Header background",
				type: "url",
				placeholder: "/assets/images/background.png",
				defaultValue: "/assets/images/background.png",
			},
			{
				key: "default_dark",
				label: "Dark mode by default",
				description: "New visitors start in dark mode unless they override it.",
				type: "boolean",
				defaultValue: "0",
			},
			{
				key: "min_staff_rank",
				label: "Minimum staff rank",
				description:
					"Minimum rank treated as staff (admin lists and public staff page).",
				type: "number",
				defaultValue: "7",
			},
		],
	},
	{
		id: "imaging",
		title: "Avatars & badges",
		icon: "image",
		description: "Imaging endpoints used for avatars and badge icons.",
		fields: [
			{
				key: "habbo_imaging_url",
				label: "Public imager URL",
				type: "url",
				defaultValue: "/imaging",
				description:
					"Public avatar endpoint (relative or absolute). Leave as /imaging to serve from this site.",
			},
			{
				key: "imaging_use_habbo_fallback",
				label: "Use Habbo.com as avatar fallback (legacy proxy)",
				type: "boolean",
				defaultValue: "1",
			},
			{
				key: "badge_base_url",
				label: "Badge icons base URL",
				type: "url",
				placeholder: "/swf/c_images/album1584",
			},
			{
				key: "badges_path",
				label: "Badges path (rares page)",
				type: "url",
			},
			{
				key: "furniture_icons_path",
				label: "Furniture icons path",
				type: "url",
			},
		],
	},
	{
		id: "client",
		title: "Nitro client",
		icon: "gamepad",
		description: "Game client loaded at /client.",
		fields: [
			{
				key: "nitro_client_url",
				label: "Nitro client URL",
				description: "Absolute or same-origin URL for the Nitro iframe.",
				type: "url",
				placeholder: "https://…/client/",
			},
			{
				key: "nitro_files_root",
				label: "Nitro-Files root (server path)",
				description:
					"Filesystem root used when importing furni / writing live assets.",
				type: "text",
				placeholder: "E:\\path\\to\\Nitro-Files",
			},
			{
				key: "gamedata_root",
				label: "Production Gamedata root (server path)",
				description:
					"Filesystem root served at /gamedata. Auto-detected as /var/www/Gamedata when present.",
				type: "text",
				placeholder: "/var/www/Gamedata",
			},
		],
	},
	{
		id: "assets",
		title: "Game assets",
		icon: "music",
		description: "Public URLs and overrides for SWF / Nitro asset packages.",
		fields: [
			{
				key: "furnidata_translate_enabled",
				label: "Translate furniture names",
				description:
					"Rebuild FurnitureData_<lang>.json with translated names after each import. Disable to skip the LibreTranslate / deep-clone work and save CPU & RAM when you don't need localized furniture names. You can still rebuild on demand via the import 'build languages' action.",
				type: "boolean",
				defaultValue: "1",
			},
			{
				key: "habbo_gamedata_hotel",
				label: "Habbo hotel for furni names",
				description:
					"Official Habbo locale used for catalog name suggestions, furni import enrichment, and badge text lookup (furnidata / external texts).",
				type: "select",
				defaultValue: "it",
				options: HABBO_GAMEDATA_HOTELS.map((h) => ({
					value: h.value,
					label: h.label,
				})),
			},
			{
				key: "soundtrack_base_url",
				label: "Song disks MP3 base URL",
				type: "url",
				defaultValue: "/swf/dcr/hof_furni/mp3/",
			},
			{
				key: "furni_data_mirror_path",
				label: "FurnitureData mirror path",
				type: "text",
			},
			{
				key: "figure_swf_base_url",
				label: "Figure SWF base URL (override)",
				type: "url",
			},
			{
				key: "effect_swf_base_url",
				label: "Effect SWF base URL (override)",
				type: "url",
			},
			{
				key: "pet_swf_base_url",
				label: "Pet SWF base URL (override)",
				type: "url",
			},
		],
	},
	{
		id: "radio",
		title: "Radio",
		icon: "music",
		description: "Public radio player and DJ monitoring feeds.",
		fields: [
			{
				key: "radio_enabled",
				label: "Enable radio player",
				type: "boolean",
				defaultValue: "0",
			},
			{
				key: "radio_name",
				label: "Radio display name",
				type: "text",
			},
			{
				key: "radio_stream_url",
				label: "Stream URL",
				type: "url",
			},
			{
				key: "radio_now_playing_api_url",
				label: "Now-playing API URL",
				type: "url",
			},
			{
				key: "radio_listeners_api_url",
				label: "Listeners API URL",
				type: "url",
			},
		],
	},
	{
		id: "security",
		title: "Security & registration",
		icon: "shield",
		description: "Account limits, captcha and staff 2FA.",
		fields: [
			{
				key: "force_staff_2fa",
				label: "Require 2FA for staff",
				description: "Staff without 2FA are redirected to set it up.",
				type: "boolean",
				defaultValue: "0",
			},
			{
				key: "require_email_verification",
				label: "Require email verification",
				description:
					"Block login until the account email is verified (accounts without email are unaffected).",
				type: "boolean",
				defaultValue: "0",
			},
			{
				key: "max_accounts_per_ip",
				label: "Max accounts per IP",
				description: "0 = unlimited.",
				type: "number",
				defaultValue: "0",
			},
			{
				key: "captcha_provider",
				label: "Captcha provider",
				description: "none | turnstile | recaptcha | hcaptcha",
				type: "text",
				defaultValue: "none",
			},
			{
				key: "turnstile_site_key",
				label: "Turnstile site key",
				type: "text",
			},
			{
				key: "hcaptcha_site_key",
				label: "hCaptcha site key",
				type: "text",
			},
			{
				key: "recaptcha_site_key",
				label: "reCAPTCHA site key",
				type: "text",
			},
			{
				key: "abuse_guard_enabled",
				label: "Enable abuse guard",
				type: "boolean",
				defaultValue: "0",
			},
			{
				key: "abuse_guard_threshold",
				label: "Abuse guard threshold",
				type: "number",
				defaultValue: "200",
			},
			{
				key: "abuse_guard_window_seconds",
				label: "Abuse guard window (seconds)",
				type: "number",
				defaultValue: "10",
			},
		],
	},
	{
		id: "misc",
		title: "Other",
		icon: "link",
		description: "Extra hotel features.",
		fields: [
			{
				key: "drawbadge.price",
				label: "Draw-badge price",
				type: "number",
				defaultValue: "0",
			},
		],
	},
];

export const MANAGED_SETTING_KEYS: string[] = SETTINGS_GROUPS.flatMap((g) =>
	g.fields.map((f) => f.key),
);

export const BOOLEAN_KEYS = new Set(
	SETTINGS_GROUPS.flatMap((g) =>
		g.fields.filter((f) => f.type === "boolean").map((f) => f.key),
	),
);

export const FIELD_DEFAULTS: Record<string, string> = Object.fromEntries(
	SETTINGS_GROUPS.flatMap((g) =>
		g.fields
			.filter((f) => f.defaultValue != null)
			.map((f) => [f.key, f.defaultValue as string]),
	),
);
