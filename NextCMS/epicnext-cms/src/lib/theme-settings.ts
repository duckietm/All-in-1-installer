import {
	THEME_COLOR_KEYS,
	type ThemeColorKey,
	type ThemeMode,
	type ThemePreset,
} from "@/lib/theme-presets";

export function settingKey(key: ThemeColorKey, mode: ThemeMode): string {
	return mode === "light" ? key : `${key}_dark`;
}

export function presetSettings(preset: ThemePreset): Array<[string, string]> {
	return (["light", "dark"] as const).flatMap((mode) =>
		THEME_COLOR_KEYS.map(
			(key) => [settingKey(key, mode), preset[mode][key]] as [string, string],
		),
	);
}
