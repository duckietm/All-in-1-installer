const CLASSNAME_CHAR_RE = /^[a-z0-9_*\-.]+$/;

export function getBaseClassname(classname: string): string {
	const star = classname.indexOf("*");
	return star >= 0 ? classname.substring(0, star) : classname;
}

export function getSafeClassnameStem(classname: string): string {
	return classname.replace(/\*/g, "_");
}

export function getIconFileName(classname: string): string {
	return `${getSafeClassnameStem(classname)}_icon.png`;
}

export function getSwfFileName(classname: string): string {
	return `${getBaseClassname(classname)}.swf`;
}

/** The two extensions a furniture bundle may carry. */
export const BUNDLE_EXT_CHOICES = [".hab", ".nitro"] as const;
export type FurnitureBundleExt = (typeof BUNDLE_EXT_CHOICES)[number];

/**
 * Read an env value via a computed key so Next does not inline it at build time
 * — changing it should take effect on restart, not require a rebuild (same
 * pattern as `runtime-asset-config.ts`).
 */
function readBundleExtEnv(): string | undefined {
	const name = "FURNI_BUNDLE_EXT";
	// `classname.ts` is also imported by client components for its pure string
	// helpers, where `process` does not exist at runtime. Reading env is a
	// server concern; on the client fall back to the default extension.
	if (typeof process === "undefined") return undefined;
	return process.env[name]?.trim() || undefined;
}

/**
 * Resolve the local furniture-bundle extension this deployment's client asks
 * for. Set `FURNI_BUNDLE_EXT` in `.env` to `hab`/`.hab` or `nitro`/`.nitro`;
 * anything missing or unrecognised falls back to `.hab`.
 */
export function resolveLocalBundleExt(
	raw: string | undefined = readBundleExtEnv(),
): FurnitureBundleExt {
	const value = raw?.trim().toLowerCase();
	if (!value) return ".hab";
	const normalized = value.startsWith(".") ? value : `.${value}`;
	return (BUNDLE_EXT_CHOICES as readonly string[]).includes(normalized)
		? (normalized as FurnitureBundleExt)
		: ".hab";
}

/**
 * Extension locally stored furniture bundles are written with. This deployment's
 * Nitro client requests `<classname>.hab` by default, but a stock Nitro client
 * asks for `.nitro` — choose with `FURNI_BUNDLE_EXT`. New imports and repairs
 * produce this extension.
 */
export const LOCAL_BUNDLE_EXT: FurnitureBundleExt = resolveLocalBundleExt();

/**
 * Extension remote sources serve bundles with. Upstream (Habbo's CDN and every
 * configured clone source) keeps shipping `.nitro`, so download URLs are built
 * with this and only re-written to `LOCAL_BUNDLE_EXT` once they land on disk.
 */
export const SOURCE_BUNDLE_EXT = ".nitro" as const;

/**
 * Every extension a local bundle may be stored under, the configured one first
 * so it always wins over a same-stem legacy file.
 */
export const LOCAL_BUNDLE_EXTS: readonly FurnitureBundleExt[] = [
	LOCAL_BUNDLE_EXT,
	...BUNDLE_EXT_CHOICES.filter((ext) => ext !== LOCAL_BUNDLE_EXT),
];

/** Primary local bundle name — the configured extension wins over the legacy one. */
export function getNitroFileName(classname: string): string {
	return `${getBaseClassname(classname)}${LOCAL_BUNDLE_EXT}`;
}

/** Every local file name this classname's bundle may be stored under. */
export function getLocalBundleFileNames(classname: string): string[] {
	const base = getBaseClassname(classname);
	return LOCAL_BUNDLE_EXTS.map((ext) => `${base}${ext}`);
}

/** File name for an explicit extension — use `SOURCE_BUNDLE_EXT` for URLs. */
export function getBundleFileName(
	classname: string,
	ext: string = LOCAL_BUNDLE_EXT,
): string {
	return `${getBaseClassname(classname)}${ext}`;
}

export function normalizeClassname(raw: string): string {
	return raw.trim().toLowerCase();
}

export function isValidClassname(classname: string): boolean {
	if (!classname) return false;
	return CLASSNAME_CHAR_RE.test(classname);
}

/**
 * Asset-name safety check for values that become file names (swf / nitro / icon).
 *
 * The real rule is "cannot escape the directory": no path separators, so `../`
 * is structurally impossible. Case matters here — classnames in gamedata are
 * mixed-case (`recycler_kintsugiB`), so this must not be folded to lowercase the
 * way `isValidClassname` presumes.
 */
const ASSET_NAME_RE = /^[\w*.-]+$/;

export function isSafeAssetName(name: string): boolean {
	const trimmed = name.trim();
	if (!trimmed) return false;
	if (!ASSET_NAME_RE.test(trimmed)) return false;
	return !trimmed.includes("..");
}

export const LOCAL_ICON_URL_PREFIX = "/swf/dcr/hof_furni/icons/";

export function getLocalIconUrl(classname: string): string {
	return `${LOCAL_ICON_URL_PREFIX}${encodeURIComponent(getIconFileName(classname))}`;
}

export function getHabboCdnIconUrl(
	classname: string,
	revision: number,
): string {
	const base = getBaseClassname(classname);
	return `https://images.habbo.com/dcr/hof_furni/${revision}/${encodeURIComponent(base)}_icon.png`;
}
