/** Setting keys whose value must never be sent to the browser. */
const SECRET_SETTING_KEYS = new Set([
	"turnstile_secret",
	"recaptcha_secret",
	"hcaptcha_secret",
	"radio_azurecast_api_key",
	"radio_sambroadcaster_password",
	"radio_virtual_dj_password",
	"radio_discord_webhook_url",
	"gitea_token",
]);

/**
 * A key is a secret when it is explicitly listed above, or when its name alone
 * says so (`*_secret`, `*_password`, `*_api_key`, ...). Used by the settings UI
 * to avoid shipping credentials in the RSC payload, and by the write actions to
 * keep "blank means keep the stored value" semantics instead of wiping secrets.
 */
export function isSecretSettingKey(key: string): boolean {
	const lower = key.toLowerCase();
	if (SECRET_SETTING_KEYS.has(lower)) return true;
	return /(^|_)(secret|password|passwd|token|api_?key|private_?key|credential)$/.test(
		lower,
	);
}

/** Replace a secret with a marker for UI rendering. */
export const SECRET_PLACEHOLDER = "••••••••";
