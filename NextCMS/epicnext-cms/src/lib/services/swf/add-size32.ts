import sharp from "sharp";
import type { SpriteImage } from "./image-decoder";
import {
	buildSpritesheet,
	createNitroBundle,
	parseNitroBundle,
} from "./nitro-builder";

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface NitroFrame {
	frame: { x: number; y: number; w: number; h: number };
	rotated?: boolean;
	trimmed?: boolean;
	spriteSourceSize?: { x: number; y: number; w: number; h: number };
	sourceSize?: { w: number; h: number };
	pivot?: { x: number; y: number };
}

export function nitroHasSize32(json: Record<string, unknown>): boolean {
	const vis = json.visualizations as Array<{ size?: number }> | undefined;
	return Array.isArray(vis) && vis.some((v) => v?.size === 32);
}

/**
 * Synthesize a size-32 visualization for a furniture `.nitro` bundle by
 * downscaling the largest existing sprite (usually size 64). No SWF is needed
 * — the 32 frame is generated from pixels already in the bundle. Returns the
 * new bundle buffer, or `null` when it already has a 32 frame or none can be
 * derived.
 */
export async function addSize32ToBundle(
	buffer: Buffer,
): Promise<Buffer | null> {
	const { json, texture, textureFormat, jsonFileName } =
		parseNitroBundle(buffer);
	if (nitroHasSize32(json)) return null;

	const name = (json.name as string) || jsonFileName.replace(/\.json$/, "");
	const assets =
		(json.assets as Record<string, { x: number; y: number }>) || {};
	const spritesheet = json.spritesheet as
		| { frames?: Record<string, NitroFrame> }
		| undefined;
	const frames = spritesheet?.frames;
	if (!frames) return null;

	const sizeRe = new RegExp(`^${escapeRe(name)}_(\\d+)_a_(\\d+)_(\\d+)$`);
	let sourceSize = -1;
	for (const key of Object.keys(assets)) {
		const m = key.match(sizeRe);
		if (m) sourceSize = Math.max(sourceSize, Number(m[1]));
	}
	// Need a reasonably sized source to derive a quality 32 frame.
	if (sourceSize < 8 || sourceSize === 32) return null;

	const scale = 32 / sourceSize;
	const sourceAssetKeys = Object.keys(assets).filter((key) => {
		const m = key.match(sizeRe);
		return m && Number(m[1]) === sourceSize;
	});

	const images: SpriteImage[] = [];
	let id = 0;

	// Re-pack every existing frame (so the sheet is rebuilt consistently).
	for (const [frameName, frame] of Object.entries(frames)) {
		const f = frame.frame;
		if (!f || f.w <= 0 || f.h <= 0) continue;
		const { data, info } = await sharp(texture)
			.extract({ left: f.x, top: f.y, width: f.w, height: f.h })
			.raw()
			.ensureAlpha()
			.toBuffer({ resolveWithObject: true });
		images.push({
			id: id++,
			name: frameName,
			width: info.width,
			height: info.height,
			pixels: Buffer.from(data),
		});
	}

	// For each source-size asset, create a downscaled 32 frame.
	const newAssets: Record<string, { x: number; y: number }> = {};
	for (const assetKey of sourceAssetKeys) {
		const m = assetKey.match(sizeRe);
		if (!m) continue;
		const dir = m[2];
		const layer = m[3];
		const frameName = `${name}_${assetKey}`;
		const frame = frames[frameName];
		if (!frame) continue;
		const f = frame.frame;
		if (f.w <= 0 || f.h <= 0) continue;

		const src = await sharp(texture)
			.extract({ left: f.x, top: f.y, width: f.w, height: f.h })
			.raw()
			.ensureAlpha()
			.toBuffer({ resolveWithObject: true });

		const targetW = Math.max(1, Math.round(f.w * scale));
		const targetH = Math.max(1, Math.round(f.h * scale));

		const resized = await sharp(src.data, {
			raw: { width: src.info.width, height: src.info.height, channels: 4 },
		})
			.resize(targetW, targetH, { fit: "fill" })
			.raw()
			.ensureAlpha()
			.toBuffer({ resolveWithObject: true });

		const newAssetKey = `${name}_32_a_${dir}_${layer}`;
		const newFrameName = `${name}_${newAssetKey}`;
		images.push({
			id: id++,
			name: newFrameName,
			width: resized.info.width,
			height: resized.info.height,
			pixels: Buffer.from(resized.data),
		});

		const orig = assets[assetKey];
		newAssets[newAssetKey] = {
			x: Math.round((orig?.x ?? 0) * scale),
			y: Math.round((orig?.y ?? 0) * scale),
		};
	}

	if (Object.keys(newAssets).length === 0) return null;

	// Preserve the source bundle's texture format: regenerating a scale must
	// not silently downgrade a WebP bundle back to PNG.
	const { texture: newTexture, frames: newFrames } = await buildSpritesheet(
		images,
		{ format: textureFormat },
	);

	// Update existing frame coordinates (sheet was rebuilt).
	for (const [frameName, frame] of Object.entries(frames)) {
		const rect = newFrames.get(frameName);
		if (rect) {
			frame.frame.x = rect.x;
			frame.frame.y = rect.y;
			frame.frame.w = rect.w;
			frame.frame.h = rect.h;
		}
	}

	// Add the new 32 frames.
	for (const assetKey of Object.keys(newAssets)) {
		const frameName = `${name}_${assetKey}`;
		const rect = newFrames.get(frameName);
		if (!rect) continue;
		frames[frameName] = {
			frame: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
			rotated: false,
			trimmed: false,
			spriteSourceSize: { x: 0, y: 0, w: rect.w, h: rect.h },
			sourceSize: { w: rect.w, h: rect.h },
			pivot: { x: 0.5, y: 0.5 },
		};
	}

	// Merge new assets into the asset map.
	for (const [assetKey, offset] of Object.entries(newAssets)) {
		assets[assetKey] = offset as { x: number; y: number };
	}

	// Add a size-32 visualization mirroring the source-size one.
	const vis = (json.visualizations as Array<Record<string, unknown>>) || [];
	const sourceVis = vis.find((v) => v.size === sourceSize);
	if (sourceVis) {
		vis.push({ ...sourceVis, size: 32 });
	}

	// Keep the client-facing image pointer aligned with the member
	// `createNitroBundle` is about to write.
	const sheet = (json.spritesheet ?? {}) as Record<string, unknown>;
	const meta = (sheet.meta ?? {}) as Record<string, unknown>;
	sheet.meta = { ...meta, image: `${name}.${textureFormat}` };
	json.spritesheet = sheet;

	return createNitroBundle(json, newTexture, name);
}
