import { getTranslations } from "next-intl/server";
import {
	saveRadioSetting,
	saveRadioSettings,
} from "@/actions/admin-radio-extra";
import { StatusCard } from "@/components/admin/dashboard";
import { Button } from "@/components/ui/button";
import { db, WebsiteSetting } from "@/lib/db";

type Field = { key: string; comment: string; secret?: boolean };
type Group = { title: string; fields: Field[] };

const GROUPS: Group[] = [
	{
		title: "AzureCast & Stream",
		fields: [
			{ key: "radio_enabled", comment: "Radio enabled (0=no, 1=yes)" },
			{ key: "radio_stream_url", comment: "Main stream URL" },
			{ key: "radio_stream_backup_url", comment: "Backup stream URL" },
			{ key: "radio_azurecast_base_url", comment: "AzureCast base URL" },
			{ key: "radio_azurecast_station_id", comment: "AzureCast station ID" },
			{
				key: "radio_azurecast_api_key",
				comment: "AzureCast API key",
				secret: true,
			},
			{ key: "radio_azurecast_port", comment: "AzureCast stream port" },
			{
				key: "radio_azurecast_protocol",
				comment: "AzureCast protocol (http/https)",
			},
			{
				key: "radio_azurecast_use_proxy",
				comment: "Use AzureCast proxy (0=no, 1=yes)",
			},
		],
	},
	{
		title: "External sources",
		fields: [
			{
				key: "radio_sambroadcaster_api_url",
				comment: "Sambroadcaster API URL",
			},
			{
				key: "radio_sambroadcaster_password",
				comment: "Sambroadcaster password",
				secret: true,
			},
			{ key: "radio_virtual_dj_url", comment: "Virtual DJ URL" },
			{
				key: "radio_virtual_dj_password",
				comment: "Virtual DJ password",
				secret: true,
			},
			{ key: "radio_djs_api_url", comment: "DJs API URL" },
		],
	},
	{
		title: "Player",
		fields: [
			{
				key: "radio_style",
				comment: "Player style (dark/light/blue/purple/pink/gold)",
			},
			{
				key: "radio_player_type",
				comment: "Player type (default/minimal/embedded)",
			},
			{
				key: "radio_auto_play",
				comment: "Auto-play on page load (0=no, 1=yes)",
			},
			{ key: "radio_auto_play_delay", comment: "Auto-play delay in seconds" },
			{ key: "radio_mute_on_start", comment: "Muted on start (0=no, 1=yes)" },
			{ key: "radio_volume", comment: "Default volume (0-100)" },
			{
				key: "radio_language",
				comment: "Default language (nl/en/de/fr/es/pt/it/br)",
			},
			{
				key: "radio_multi_language_enabled",
				comment: "Multi-language support (0=no, 1=yes)",
			},
			{ key: "radio_player_color_primary", comment: "Player primary color" },
			{
				key: "radio_player_color_secondary",
				comment: "Player secondary color",
			},
			{ key: "radio_player_color_text", comment: "Player text color" },
			{ key: "radio_player_color_accent", comment: "Player accent color" },
		],
	},
	{
		title: "Now playing & history",
		fields: [
			{
				key: "radio_now_playing_enabled",
				comment: "Show now playing info (0=no, 1=yes)",
			},
			{ key: "radio_now_playing_api_url", comment: "Now playing API URL" },
			{
				key: "radio_now_playing_cache_duration",
				comment: "Now playing cache duration in seconds",
			},
			{
				key: "radio_show_song_history",
				comment: "Show song history (0=no, 1=yes)",
			},
			{
				key: "radio_song_history_count",
				comment: "Number of songs in history",
			},
		],
	},
	{
		title: "Listeners",
		fields: [
			{
				key: "radio_listeners_enabled",
				comment: "Show listeners count (0=no, 1=yes)",
			},
			{ key: "radio_listeners_api_url", comment: "Listeners API URL" },
			{
				key: "radio_listeners_update_interval",
				comment: "Listeners update interval in seconds",
			},
			{
				key: "radio_show_listener_peak",
				comment: "Show listener peak (0=no, 1=yes)",
			},
			{ key: "radio_peak_reset_time", comment: "Peak reset time (HH:MM)" },
			{
				key: "radio_store_listener_stats",
				comment: "Store listener statistics (0=no, 1=yes)",
			},
			{
				key: "radio_stats_retention_days",
				comment: "Statistics retention in days",
			},
			{
				key: "radio_show_listener_graph",
				comment: "Show listener graph (0=no, 1=yes)",
			},
			{
				key: "radio_listener_graph_period",
				comment: "Listener graph period (1h/6h/12h/24h/7d)",
			},
			{
				key: "radio_show_average_listeners",
				comment: "Show average listeners (0=no, 1=yes)",
			},
			{
				key: "radio_show_unique_listeners",
				comment: "Show unique listeners (0=no, 1=yes)",
			},
			{
				key: "radio_listener_alerts_enabled",
				comment: "Enable listener alerts (0=no, 1=yes)",
			},
			{
				key: "radio_min_listeners_threshold",
				comment: "Minimum listeners threshold",
			},
			{
				key: "radio_listener_alert_threshold_high",
				comment: "High listener alert threshold",
			},
			{
				key: "radio_listener_alert_threshold_low",
				comment: "Low listener alert threshold",
			},
		],
	},
	{
		title: "DJ",
		fields: [
			{
				key: "radio_show_current_dj",
				comment: "Show current DJ (0=no, 1=yes)",
			},
			{ key: "radio_current_dj_id", comment: "Manual DJ user ID" },
			{ key: "radio_dj_avatar_size", comment: "DJ avatar size in pixels" },
			{
				key: "radio_show_dj_schedule",
				comment: "Show DJ schedule (0=no, 1=yes)",
			},
			{
				key: "radio_auto_dj_detection",
				comment: "Enable auto DJ detection (0=no, 1=yes)",
			},
			{
				key: "radio_dj_detection_interval",
				comment: "DJ detection interval in seconds",
			},
			{
				key: "auto_dj_detected_action",
				comment: "Action on DJ detection (set_dj/notify/both)",
			},
		],
	},
	{
		title: "Shouts & chat",
		fields: [
			{ key: "radio_shouts_enabled", comment: "Enable shouts (0=no, 1=yes)" },
			{
				key: "radio_shouts_max_length",
				comment: "Maximum shout length in characters",
			},
			{ key: "radio_shouts_cooldown", comment: "Shout cooldown in seconds" },
			{
				key: "radio_shouts_require_moderation",
				comment: "Require shout moderation (0=no, 1=yes)",
			},
			{ key: "radio_chat_enabled", comment: "Enable live chat (0=no, 1=yes)" },
			{
				key: "radio_chat_position",
				comment: "Chat position (left/right/bottom)",
			},
			{ key: "radio_chat_width", comment: "Chat width in pixels" },
			{ key: "radio_chat_height", comment: "Chat height in pixels" },
			{
				key: "radio_chat_messages_count",
				comment: "Number of chat messages to show",
			},
			{
				key: "radio_chat_show_timestamps",
				comment: "Show chat timestamps (0=no, 1=yes)",
			},
			{
				key: "radio_chat_allow_links",
				comment: "Allow links in chat (0=no, 1=yes)",
			},
			{
				key: "radio_chat_allow_emojis",
				comment: "Allow emojis in chat (0=no, 1=yes)",
			},
		],
	},
	{
		title: "Requests & widget",
		fields: [
			{
				key: "radio_request_form_enabled",
				comment: "Enable song requests (0=no, 1=yes)",
			},
			{
				key: "radio_request_max_per_user",
				comment: "Maximum requests per user",
			},
			{ key: "radio_request_cooldown", comment: "Request cooldown in seconds" },
			{
				key: "radio_voting_enabled",
				comment: "Enable request voting (0=no, 1=yes)",
			},
			{
				key: "radio_voting_show_song_requests",
				comment: "Show requests with votes (0=no, 1=yes)",
			},
			{
				key: "radio_widget_enabled",
				comment: "Enable radio widget (0=no, 1=yes)",
			},
			{
				key: "radio_widget_show_globally",
				comment: "Show widget globally (0=no, 1=yes)",
			},
			{ key: "radio_widget_position", comment: "Widget position" },
		],
	},
	{
		title: "Offline & branding",
		fields: [
			{
				key: "radio_show_offline_message",
				comment: "Show offline message (0=no, 1=yes)",
			},
			{ key: "radio_offline_message", comment: "Offline message text" },
			{ key: "radio_offline_image", comment: "Offline page image URL" },
			{ key: "radio_background_image", comment: "Background image URL" },
			{ key: "radio_logo_url", comment: "Radio logo URL" },
		],
	},
	{
		title: "Applications",
		fields: [
			{
				key: "radio_applications_enabled",
				comment: "Enable DJ applications (0=no, 1=yes)",
			},
			{
				key: "radio_applications_max_per_day",
				comment: "Maximum applications per day",
			},
			{
				key: "radio_applications_require_approval",
				comment: "Require application approval (0=no, 1=yes)",
			},
		],
	},
	{
		title: "Stats display",
		fields: [
			{
				key: "radio_stats_show_daily",
				comment: "Show daily statistics (0=no, 1=yes)",
			},
			{
				key: "radio_stats_show_weekly",
				comment: "Show weekly statistics (0=no, 1=yes)",
			},
			{
				key: "radio_stats_show_monthly",
				comment: "Show monthly statistics (0=no, 1=yes)",
			},
			{
				key: "radio_stats_show_top_djs",
				comment: "Show top DJs (0=no, 1=yes)",
			},
			{
				key: "radio_stats_show_top_songs",
				comment: "Show top songs (0=no, 1=yes)",
			},
		],
	},
	{
		title: "Social & contact",
		fields: [
			{ key: "radio_social_facebook", comment: "Facebook URL" },
			{ key: "radio_social_twitter", comment: "Twitter URL" },
			{ key: "radio_social_instagram", comment: "Instagram URL" },
			{ key: "radio_social_discord", comment: "Discord URL" },
			{ key: "radio_social_youtube", comment: "YouTube URL" },
			{ key: "radio_social_twitch", comment: "Twitch URL" },
			{ key: "radio_contact_email", comment: "Contact email" },
			{ key: "radio_contact_phone", comment: "Contact phone" },
			{ key: "radio_about_text", comment: "About radio text" },
		],
	},
	{
		title: "Discord webhook & custom code",
		fields: [
			{
				key: "radio_discord_webhook_url",
				comment: "Discord webhook URL",
				secret: true,
			},
			{
				key: "radio_discord_enabled",
				comment: "Enable Discord notifications (0=no, 1=yes)",
			},
			{
				key: "radio_discord_dj_live",
				comment: "Discord DJ live notification (0=no, 1=yes)",
			},
			{
				key: "radio_discord_song_changes",
				comment: "Discord song change notification (0=no, 1=yes)",
			},
			{
				key: "radio_discord_custom_message",
				comment: "Custom Discord message template",
			},
			{ key: "radio_custom_css", comment: "Custom CSS code" },
			{ key: "radio_custom_js", comment: "Custom JavaScript code" },
		],
	},
];

const CURATED_KEYS = new Set(GROUPS.flatMap((g) => g.fields.map((f) => f.key)));

export default async function AdminRadioSettingsPage() {
	const t = await getTranslations("pages.admin.radio");

	let values: Map<string, string> = new Map();
	let dbError = false;
	let extra: Field[] = [];

	try {
		const rows = await db
			.select({
				key: WebsiteSetting.key,
				value: WebsiteSetting.value,
				comment: WebsiteSetting.comment,
			})
			.from(WebsiteSetting);
		values = new Map(rows.map((r) => [r.key, r.value]));
		extra = rows
			.filter(
				(r) =>
					(r.key.startsWith("radio_") || r.key.startsWith("auto_dj_")) &&
					!CURATED_KEYS.has(r.key),
			)
			.map((r) => ({ key: r.key, comment: r.comment ?? "" }));
	} catch {
		dbError = true;
	}

	const groups: Group[] = extra.length
		? [...GROUPS, { title: t("settingsForm.otherSettings"), fields: extra }]
		: GROUPS;

	const allKeys = [...CURATED_KEYS, ...extra.map((e) => e.key)].join(",");

	const totalKeys = CURATED_KEYS.size + extra.length;
	const configuredKeys = [...CURATED_KEYS].filter((k) => {
		const v = values.get(k);
		return v != null && v !== "";
	}).length;
	const radioEnabled = (values.get("radio_enabled") ?? "") === "1";

	return (
		<main>
			{dbError ? (
				<div className="admin-card mb-6">
					<p className="text-xs theme-text-muted dark:theme-text-muted m-0">
						{t("settingsForm.dbError")}
					</p>
				</div>
			) : (
				<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5 mb-6">
					<StatusCard
						label="Radio"
						value={
							radioEnabled
								? t("settingsForm.enabled")
								: t("settingsForm.disabled")
						}
						state={radioEnabled ? "ok" : "danger"}
						icon="💻"
					/>
					<StatusCard
						label={t("settingsForm.totalKeys")}
						value={totalKeys}
						icon="🔑"
					/>
					<StatusCard
						label={t("settingsForm.configured")}
						value={`${configuredKeys}/${CURATED_KEYS.size}`}
						hint={t("settingsForm.curatedHint")}
						icon="⚙️"
					/>
					<StatusCard
						label={t("settingsForm.customKeys")}
						value={extra.length}
						state={extra.length > 0 ? "warn" : "neutral"}
						icon="➕"
					/>
				</div>
			)}

			<form action={saveRadioSettings}>
				<input type="hidden" name="__keys" value={allKeys} />
				<div className="flex justify-end mb-4">
					<Button type="submit" variant="default">
						{t("settingsForm.saveAll")}
					</Button>
				</div>

				{groups.map((group) => (
					<section
						key={group.title}
						className="admin-card"
						style={{ marginBottom: "1.25rem" }}
					>
						<h2 style={{ marginTop: 0 }}>{group.title}</h2>
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							{group.fields.map((field) => (
								<div key={field.key}>
									<label
										htmlFor={`f_${field.key}`}
										style={{
											display: "block",
											fontWeight: 700,
											fontSize: "0.85rem",
										}}
									>
										{field.key}
									</label>
									<input
										id={`f_${field.key}`}
										name={field.key}
										// Credentials are masked and blank means "keep".
										type={field.secret ? "password" : "text"}
										autoComplete="off"
										placeholder={
											field.secret ? "Leave blank to keep" : undefined
										}
										defaultValue={
											field.secret ? "" : (values.get(field.key) ?? "")
										}
										style={{ width: "100%" }}
									/>
									{field.comment ? (
										<p
											className="text-xs theme-text-muted dark:theme-text-muted"
											style={{ margin: "0.2rem 0 0" }}
										>
											{field.comment}
										</p>
									) : null}
								</div>
							))}
						</div>
					</section>
				))}

				<div className="flex justify-end">
					<Button type="submit" variant="default">
						{t("settingsForm.saveAll")}
					</Button>
				</div>
			</form>

			<section className="admin-card" style={{ marginTop: "1.5rem" }}>
				<h3 style={{ marginTop: 0 }}>{t("settingsForm.singleKey")}</h3>
				<form action={saveRadioSetting} className="flex gap-2 flex-wrap">
					<input
						name="key"
						placeholder={t("settingsForm.keyPlaceholder")}
						required
					/>
					<input
						name="value"
						placeholder={t("settingsForm.valuePlaceholder")}
						className="flex-1 min-w-[160px]"
					/>
					<input
						name="comment"
						placeholder={t("settingsForm.commentPlaceholder")}
					/>
					<Button type="submit" variant="default">
						{t("settingsForm.saveSingle")}
					</Button>
				</form>
			</section>
		</main>
	);
}
