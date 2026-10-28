import { decodeTextureRgba } from "@/lib/services/imager/decode-texture";
import { cropRgba } from "@/lib/services/imager/png-decode";
import { encodePng, parseNitroBundle } from "@/lib/services/swf/nitro-builder";

interface FurniAsset {
	x?: number;
	y?: number;
	source?: string;
}
interface FurniFrame {
	frame: { x: number; y: number; w: number; h: number };
	rotated?: boolean;
}
interface FurniNitroJson {
	name?: string;
	assets?: Record<string, FurniAsset>;
	spritesheet?: { frames?: Record<string, FurniFrame> };
}

/**
 * Locate the spritesheet frame for an asset. Try the two exact spellings
 * first (with and without a trailing `.png`), then one case-insensitive pass
 * so a converter that lowercased the frame keys still resolves.
 */
function findFrame(
	frames: Record<string, FurniFrame>,
	name: string,
	pixelAsset: string,
): FurniFrame | undefined {
	const direct =
		frames[`${name}_${pixelAsset}`] ?? frames[`${name}_${pixelAsset}.png`];
	if (direct) return direct;

	const wanted = new Set([
		`${name}_${pixelAsset}`.toLowerCase(),
		`${name}_${pixelAsset}.png`.toLowerCase(),
	]);
	for (const [key, frame] of Object.entries(frames)) {
		if (wanted.has(key.toLowerCase())) return frame;
	}
	return undefined;
}

/**
 * Extract the furni catalog icon — the `{name}_icon_a` sprite — from a Nitro
 * bundle and return it as a standalone PNG, or null if the bundle has no icon
 * asset / usable frame. Used for sources that embed furni icons inside the
 * `.nitro` instead of serving a separate `{classname}_icon.png`.
 *
 * Async because the texture is usually WebP Lossless, which needs a real codec
 * to read back out.
 */
export async function extractFurniIconPng(
	nitro: Buffer,
): Promise<Buffer | null> {
	let json: FurniNitroJson;
	let texture: Buffer;
	try {
		const parsed = parseNitroBundle(nitro);
		json = parsed.json as FurniNitroJson;
		texture = parsed.texture;
	} catch {
		return null;
	}
	const name = json.name;
	if (!name || !json.assets) return null;

	// The icon asset is conventionally `${name}_icon_a`; fall back to any
	// `${name}_icon*` the bundle exposes.
	const iconKey = json.assets[`${name}_icon_a`]
		? `${name}_icon_a`
		: Object.keys(json.assets).find((k) => k.startsWith(`${name}_icon`));
	if (!iconKey) return null;

	const asset = json.assets[iconKey];
	// An asset may alias another's pixels via `source`; the frame key is the
	// bundle name prefixed onto the asset name. Converters disagree on the
	// packing: some keep the trailing `.png`, and some lowercase the whole key
	// while leaving `name` mixed-case (`LTD_fashionistaf` -> key
	// `ltd_fashionistaf_ltd_fashionistaf_icon_a`). Match exactly first, then
	// fall back to a case-insensitive lookup so mixed-case classnames work.
	const pixelAsset = asset.source ?? iconKey;
	const frames = json.spritesheet?.frames ?? {};
	const frame = findFrame(frames, name, pixelAsset);
	if (!frame || frame.rotated) return null;
	const { x, y, w, h } = frame.frame;
	if (w <= 0 || h <= 0) return null;

	try {
		const sheet = await decodeTextureRgba(texture);
		const px = cropRgba(sheet.rgba, sheet.width, x, y, w, h);
		return encodePng(w, h, px);
	} catch {
		return null;
	}
}
