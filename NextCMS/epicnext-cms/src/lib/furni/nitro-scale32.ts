import sharp from "sharp";
import {
	buildSpritesheet,
	createNitroBundle,
	parseNitroBundle,
} from "@/lib/services/swf/nitro-builder";
import { object, resolveNitroFrame } from "./nitro-quality";

const scaleName = (name: string) => {
	const png = name.endsWith(".png");
	const base = png ? name.slice(0, -4) : name;
	const renamed = base.replace(/_64_(?=[^_]+_[0-7]_\d+$)/, "_32_");
	return png ? `${renamed}.png` : renamed;
};
const isScale = (name: string, size: number) =>
	new RegExp(`_${size}_[^_]+_[0-7]_\\d+(\\.png)?$`).test(name);
function halfOffsets(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(halfOffsets);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, v]) => [
			key,
			["x", "y", "randomX", "randomY"].includes(key) && typeof v === "number"
				? Math.round(v / 2)
				: halfOffsets(v),
		]),
	);
}
function emptyScaleDeclaration(viz: Record<string, unknown>): boolean {
	return Object.entries(viz).every(([key, value]) => {
		if (["size", "layerCount", "angle"].includes(key)) return true;
		if (key === "directions")
			return Object.values(object(value)).every(
				(direction) => Object.keys(object(direction)).length === 0,
			);
		return (
			value && typeof value === "object" && Object.keys(value).length === 0
		);
	});
}
export async function generateScale32(input: Buffer): Promise<{
	bundle: Buffer;
	before: string;
	after: string;
	count: number;
	skipped: number;
}> {
	const { json, texture, textureFormat } = parseNitroBundle(input);
	const assets = object(json.assets),
		sheet = object(json.spritesheet),
		frames = object(sheet.frames);
	const visualizations = Array.isArray(json.visualizations)
		? json.visualizations
		: [];
	if (
		Object.keys(assets).some((n) => isScale(n, 32)) ||
		Object.keys(frames).some((n) => isScale(n, 32)) ||
		visualizations.some(
			(v) => object(v).size === 32 && !emptyScaleDeclaration(object(v)),
		)
	)
		throw Error("Scale 32 already exists; original artwork is preserved");
	const viz = visualizations.find((v) => object(v).size === 64);
	const names = Object.keys(assets).filter((n) => isScale(n, 64));
	if (!viz)
		throw Error("The bundle has no scale 64 visualization to derive from");
	if (!names.length)
		throw Error("No supported scale 64 furniture sprites were found");
	if (names.length > 10000) throw Error("Too many sprites to generate safely");
	const dimensions = await sharp(texture).metadata();
	if (!dimensions.width || !dimensions.height) throw Error("Invalid texture");
	const images: {
		id: number;
		name: string;
		width: number;
		height: number;
		pixels: Buffer;
	}[] = [];
	let before = "";
	let pixels = 0;
	const skipped = new Set<string>();
	for (const name of names) {
		const asset = object(assets[name]);
		for (const key of ["x", "y"])
			if (
				asset[key] !== undefined &&
				(typeof asset[key] !== "number" || !Number.isFinite(asset[key]))
			)
				throw Error("Invalid sprite offset");
		if (typeof asset.source === "string" && asset.source !== name) {
			if (!names.includes(asset.source)) {
				skipped.add(name);
				continue;
			}
			continue;
		}
		let resolved: ReturnType<typeof resolveNitroFrame>;
		try {
			resolved = resolveNitroFrame(json, name);
		} catch (_error) {
			skipped.add(name);
			continue;
		}
		const frame = resolved.frame,
			rect = object(frame.frame);
		let sprite = await sharp(texture)
			.extract({
				left: Number(rect.x),
				top: Number(rect.y),
				width: Number(rect.w),
				height: Number(rect.h),
			})
			.png()
			.toBuffer();
		if (frame.rotated)
			sprite = await sharp(sprite).rotate(270).png().toBuffer();
		const size = await sharp(sprite).metadata();
		if (frame.trimmed) {
			const original = object(frame.sourceSize),
				offset = object(frame.spriteSourceSize);
			sprite = await sharp(sprite)
				.extend({
					left: Number(offset.x),
					top: Number(offset.y),
					right: Number(original.w) - Number(offset.x) - Number(size.width),
					bottom: Number(original.h) - Number(offset.y) - Number(size.height),
					background: { r: 0, g: 0, b: 0, alpha: 0 },
				})
				.png()
				.toBuffer();
		}
		const full = await sharp(sprite).metadata();
		const width = Math.max(1, Math.round(Number(full.width) / 2)),
			height = Math.max(1, Math.round(Number(full.height) / 2));
		pixels += width * height;
		if (pixels > 16_000_000)
			throw Error("Generated sprites exceed the texture budget");
		if (!before) before = `data:image/png;base64,${sprite.toString("base64")}`;
		images.push({
			id: images.length,
			name: scaleName(resolved.name),
			width,
			height,
			pixels: await sharp(sprite)
				.resize(width, height, { kernel: "nearest" })
				.ensureAlpha()
				.raw()
				.toBuffer(),
		});
	}
	if (!images.length) throw Error("No independent texture frames were found");
	const atlas = await buildSpritesheet(images, { format: textureFormat });
	const width = Math.max(dimensions.width, atlas.width),
		height = dimensions.height + atlas.height;
	if (width * height > 64_000_000)
		throw Error("Combined texture exceeds the texture budget");
	// The merged sheet must keep the source bundle's texture format so an
	// existing PNG bundle is not silently converted (or vice versa).
	const composited = sharp({
		create: {
			width,
			height,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	}).composite([
		{ input: texture, left: 0, top: 0 },
		{ input: atlas.texture, left: 0, top: dimensions.height },
	]);
	const combined =
		textureFormat === "webp"
			? await composited
					.webp({
						lossless: true,
						nearLossless: false,
						smartSubsample: false,
						effort: 6,
					})
					.toBuffer()
			: await composited.png().toBuffer();
	const generated = new Map<string, boolean>();
	for (const name of names)
		if (!skipped.has(name)) generated.set(scaleName(name), true);
	for (const name of names) {
		if (skipped.has(name)) continue;
		const asset = object(halfOffsets(assets[name]));
		if (typeof asset.source === "string") {
			const target = scaleName(asset.source);
			if (!generated.has(target)) continue;
			asset.source = target;
		}
		assets[scaleName(name)] = asset;
	}
	for (const [name, rect] of atlas.frames) {
		frames[name] = {
			frame: { ...rect, y: rect.y + dimensions.height },
			rotated: false,
			trimmed: false,
			spriteSourceSize: { x: 0, y: 0, w: rect.w, h: rect.h },
			sourceSize: { w: rect.w, h: rect.h },
		};
	}
	json.assets = assets;
	json.visualizations = [
		...visualizations.filter((v) => object(v).size !== 32),
		{ ...object(halfOffsets(viz)), size: 32 },
	];
	json.spritesheet = {
		...sheet,
		frames,
		meta: {
			...object(sheet.meta),
			// Keep the client-facing image pointer aligned with the member
			// `createNitroBundle` is about to write.
			image: `${String(json.name || "furniture")}.${textureFormat}`,
			size: { w: width, h: height },
		},
	};
	json.catalogStudio = {
		...object(json.catalogStudio),
		scale32: { derivedFrom: 64, method: "nearest", version: 1 },
	};
	const first = images[0];
	const preview = await sharp(first.pixels, {
		raw: { width: first.width, height: first.height, channels: 4 },
	})
		.png()
		.toBuffer();
	return {
		bundle: createNitroBundle(json, combined, String(json.name || "furniture")),
		before,
		after: `data:image/png;base64,${preview.toString("base64")}`,
		count: images.length,
		skipped: skipped.size,
	};
}
