// Syncs the Nitro/Octane runtime config URLs from environment variables into the
// renderer-config.json / renderer-config.jsonc / ui-config.json files.
//
// Uses jsonc-parser so JSONC (with // and /* */ comments) is handled safely —
// unlike a naive JSON.parse/json.load this never corrupts URLs that contain
// "https://". After this runs the files are written back as strict JSON (which
// is still valid JSONC), so downstream validation passes.
//
// Env:
//   NITRO_SRC_DIR              e.g. /var/www/Octane/public/configuration
//   NITRO_DIST_CONFIG_DIR      e.g. /var/www/Octane/dist/configuration
//   NITRO_GAMEDATA_CONF_DIR    e.g. /var/www/gamedata/config
//   NITRO_IMAGE_LIBRARY_URL, NITRO_HOF_FURNITURE_URL, NITRO_API_URL,
//   NITRO_SOCKET_URL, NITRO_GAMEDATA_URL, NITRO_ASSET_URL,
//   NITRO_FURNI_ASSET_ICON_URL
//   NITRO_URL_FORCE=1          (optional) overwrite existing values too
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("jsonc-parser");

const FILES = [
	"renderer-config.json",
	"renderer-config.jsonc",
	"ui-config.json",
];

const FORCE = process.env.NITRO_URL_FORCE === "1";

// Values that must never survive into a production config: placeholder or
// loopback hosts that originate from the upstream example files. When a key
// still holds one of these, it has been newly added by the merge step and has
// to be filled from the environment. A real, already-configured URL (the
// hotel's own domain) is NEVER rewritten, so hotel links stay exactly as the
// hotel owner configured them.
const PLACEHOLDER_RE =
	/(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\.example\.com|nitro\.example\.|hotel\.example\.|example\.org|example\.net|:5173|:2096|\$\{)/i;

function isPlaceholder(value) {
	if (!value) return true;
	return PLACEHOLDER_RE.test(value);
}

function env(name) {
	return process.env[name]?.length ? process.env[name] : null;
}

function applyOverrides(data) {
	const image = env("NITRO_IMAGE_LIBRARY_URL");
	const hof = env("NITRO_HOF_FURNITURE_URL");
	const api = env("NITRO_API_URL");
	const socket = env("NITRO_SOCKET_URL");
	const gamedata = env("NITRO_GAMEDATA_URL");
	const asset = env("NITRO_ASSET_URL");
	const icon = env("NITRO_FURNI_ASSET_ICON_URL");

	// Add-only, placeholder-aware URL fill-in. Existing real values are kept,
	// crypto.* keys are never touched, and only missing/placeholder keys are
	// filled from the environment. NITRO_URL_FORCE=1 opts back into overwriting.
	const set = (key, value) => {
		if (!value || key.startsWith("crypto.")) return;
		if (FORCE || !(key in data) || isPlaceholder(data[key])) {
			data[key] = value;
		}
	};

	set("image.library.url", image);
	set("hof.furni.url", hof);
	set("api.url", api);
	set("socket.url", socket);
	set("gamedata.url", gamedata);
	set("asset.url", asset);
	set("furni.asset.icon.url", icon);

	if (
		gamedata &&
		(!("radio.url" in data) || isPlaceholder(data["radio.url"]))
	) {
		data["radio.url"] = `${gamedata}/config/radio-stations.jsonc?t=%timestamp%`;
	}
	if (
		gamedata &&
		(!("soundboard.url" in data) || isPlaceholder(data["soundboard.url"]))
	) {
		data["soundboard.url"] =
			`${gamedata}/config/soundboard-sounds.jsonc?t=%timestamp%`;
	}
	if (gamedata) {
		const soundboardDefaults = {
			"soundboard.manifest.url": `${gamedata}/config/SoundData.json?t=%timestamp%`,
			"soundboard.sounds.url": `${gamedata}/config/soundboard-sounds.jsonc?t=%timestamp%`,
			"soundboard.layout.url": `${gamedata}/config/soundboard-layout.jsonc?t=%timestamp%`,
		};
		for (const [key, value] of Object.entries(soundboardDefaults)) {
			if (
				!(key in data) ||
				isPlaceholder(data[key]) ||
				data[key] === "configuration/soundboard-layout.jsonc"
			) {
				data[key] = value;
			}
		}
	}
	// Never force ads on/off over a hotel's own choice; only default to "off"
	// when the key does not exist yet (prevents external ad scripts from 404ing).
	if (!("show.google.ads" in data)) data["show.google.ads"] = false;
	return data;
}

const dirs = [
	env("NITRO_SRC_DIR"),
	env("NITRO_DIST_CONFIG_DIR"),
	env("NITRO_GAMEDATA_CONF_DIR"),
].filter(Boolean);

let changed = 0;
for (const dir of dirs) {
	if (!fs.existsSync(dir)) continue;
	for (const file of FILES) {
		const full = path.join(dir, file);
		if (!fs.existsSync(full)) continue;
		let content;
		try {
			content = fs.readFileSync(full, "utf-8");
		} catch {
			continue;
		}
		let data;
		try {
			data = parse(content, [], {
				allowTrailingComma: true,
				allowEmptyContent: true,
			});
		} catch (e) {
			console.error(`[sync-nitro-urls] parse error in ${full}: ${e}`);
			continue;
		}
		if (!data || typeof data !== "object") continue;
		const before = JSON.stringify(data);
		const updated = applyOverrides(data);
		if (JSON.stringify(updated) === before) continue;
		try {
			fs.writeFileSync(full, `${JSON.stringify(updated, null, 4)}\n`);
			changed++;
			console.log(`  [OK] Synced URLs: ${file} (${dir})`);
		} catch (e) {
			console.error(`[sync-nitro-urls] write error ${full}: ${e}`);
		}
	}
}

console.log(`  [OK] URL sync complete (${changed} file(s) updated)`);
process.exit(0);
