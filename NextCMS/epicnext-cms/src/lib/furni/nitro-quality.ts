import {
	encodeWebpLossless,
	isLosslessWebp,
} from "@/lib/services/swf/nitro-builder";

export interface ScaleIssue {
	asset?: string;
	message: string;
}
export interface ScaleReport {
	size: 32 | 64;
	derived?: boolean;
	state: "missing" | "issues" | "present";
	assets: string[];
	animations: string[];
	directions: string[];
	issues: ScaleIssue[];
}
export interface MemberReport {
	fileName: string;
	/** Bytes of the member as decoded out of the container. */
	rawBytes: number;
	/** Bytes the member occupies inside the container (deflated). */
	compressedBytes: number;
	/** rawBytes / compressedBytes. 1 means the deflate layer gained nothing. */
	ratio: number;
}
export interface TextureReport extends MemberReport {
	format: "png" | "webp";
	width: number;
	height: number;
	/** True when the stored texture uses a lossless codec. */
	lossless: boolean;
	/** Total texel count, i.e. width * height. */
	pixels: number;
	/** Textured sprite frames in the sheet. */
	spriteCount: number;
	/**
	 * Pixels that differ from a lossless re-encode. 0 proves the stored texture
	 * reproduces its own pixels exactly; a non-zero value is only benign when
	 * `invisibleDifferences` accounts for all of it.
	 */
	mismatchedPixels: number;
	/**
	 * Differing pixels that are fully transparent, where the stored RGB is
	 * discarded by every renderer and therefore harmless.
	 */
	invisibleDifferences: number;
	/**
	 * What this texture would weigh as WebP Lossless. Present so the studio can
	 * show a real saving, including for legacy PNG bundles.
	 */
	webpEstimate: { bytes: number; savingBytes: number };
	/** What this texture would weigh as PNG, for comparison. */
	pngEstimate: { bytes: number };
}
export interface CompressionReport {
	bundleBytes: number;
	/** Container framing: file counts, name lengths, and deflate length fields. */
	overheadBytes: number;
	json: MemberReport;
	texture: TextureReport;
	/** share of the bundle spent on the texture, 0..1. */
	textureShare: number;
}
export interface NitroQuality {
	scales: ScaleReport[];
	compression?: CompressionReport;
}
export const object = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
export function resolveNitroFrame(
	metadata: Record<string, unknown>,
	name: string,
): {
	name: string;
	asset: Record<string, unknown>;
	frame: Record<string, unknown>;
	flipH: boolean;
	flipV: boolean;
} {
	const assets = object(metadata.assets),
		frames = object(object(metadata.spritesheet).frames),
		seen = new Set<string>();
	let current = name,
		flipH = false,
		flipV = false;
	for (let depth = 0; depth < 100; depth++) {
		if (seen.has(current)) throw Error("Cyclic sprite reference");
		seen.add(current);
		const asset = object(assets[current]);
		flipH = flipH !== Boolean(asset.flipH);
		flipV = flipV !== Boolean(asset.flipV);
		if (typeof asset.source === "string" && asset.source !== current) {
			current = asset.source;
			continue;
		}
		const candidates =
			typeof metadata.name === "string"
				? [current, `${metadata.name}_${current}`]
				: [current];
		for (const candidate of candidates) {
			for (const key of [candidate, `${candidate}.png`]) {
				const frame = object(frames[key]);
				if (Object.keys(frame).length)
					return {
						name: key,
						asset: object(assets[name]),
						frame,
						flipH,
						flipV,
					};
			}
		}
		throw Error(`Missing texture frame: ${current}`);
	}
	throw Error("Sprite reference chain is too long");
}
export function inspectNitroScales(
	metadata: Record<string, unknown>,
	width: number,
	height: number,
): NitroQuality {
	const assets = object(metadata.assets),
		visualizations = Array.isArray(metadata.visualizations)
			? metadata.visualizations
			: [];
	return {
		scales: ([32, 64] as const).map((size) => {
			const names = Object.keys(assets)
				.filter((name) => name.includes(`_${size}_`))
				.sort();
			const viz = object(visualizations.find((v) => object(v).size === size)),
				issues: ScaleIssue[] = [];
			if (names.length && !Object.keys(viz).length)
				issues.push({
					message: "Sprites exist but the scale visualization is missing",
				});
			if (!names.length && Object.keys(viz).length)
				issues.push({
					message:
						"Visualization exists but no sprites were found for this scale",
				});
			for (const name of names) {
				const asset = object(assets[name]);
				if (
					["x", "y"].some(
						(key) =>
							asset[key] !== undefined &&
							(typeof asset[key] !== "number" || !Number.isFinite(asset[key])),
					)
				)
					issues.push({ asset: name, message: "Invalid sprite offset" });
				try {
					const resolved = resolveNitroFrame(metadata, name),
						rect = object(resolved.frame.frame);
					if (resolved.name.includes(`_${size === 32 ? 64 : 32}_`))
						issues.push({
							asset: name,
							message:
								"Sprite references the other scale; this is not native artwork at this scale",
						});
					const { x, y, w, h } = rect;
					if (
						![x, y, w, h].every(
							(n) => typeof n === "number" && Number.isInteger(n),
						) ||
						Number(x) < 0 ||
						Number(y) < 0 ||
						Number(w) <= 0 ||
						Number(h) <= 0 ||
						Number(x) + Number(w) > width ||
						Number(y) + Number(h) > height
					)
						issues.push({
							asset: name,
							message: "Texture frame is outside the image bounds",
						});
				} catch (error) {
					issues.push({ asset: name, message: (error as Error).message });
				}
			}
			const animations = Object.keys(object(viz.animations));
			for (const [id, animation] of Object.entries(object(viz.animations))) {
				const anim = object(animation);
				for (const key of ["transitionTo", "transitionFrom"])
					if (
						anim[key] !== undefined &&
						Number(anim[key]) >= 0 &&
						!animations.includes(String(anim[key]))
					)
						issues.push({
							message: `Animation ${id}: missing transition ${anim[key]}`,
						});
			}
			for (const [animationId, animation] of Object.entries(
				object(viz.animations),
			)) {
				for (const [layerId, layer] of Object.entries(
					object(object(animation).layers),
				)) {
					const layerName = /^\d+$/.test(layerId)
						? String.fromCharCode(97 + Number(layerId))
						: layerId;
					const frameIds = new Set<number>();
					for (const sequence of Object.values(
						object(object(layer).frameSequences),
					)) {
						for (const frame of Object.values(
							object(object(sequence).frames),
						)) {
							const id = object(frame).id;
							if (typeof id === "number" && Number.isInteger(id) && id >= 0)
								frameIds.add(id);
						}
					}
					for (const frameId of frameIds)
						if (
							!names.some(
								(name) =>
									name.includes(`_${size}_${layerName}_`) &&
									name.endsWith(`_${frameId}`),
							)
						)
							issues.push({
								message: `Animation ${animationId}: no sprite found for layer ${layerId}, frame ${frameId}`,
							});
				}
			}
			const directions = [
				...new Set(
					names
						.map(
							(name) => name.match(new RegExp(`_${size}_[^_]+_([0-7])_`))?.[1],
						)
						.filter((v): v is string => v !== undefined),
				),
			].sort();
			return {
				size,
				derived:
					size === 32 &&
					object(object(metadata.catalogStudio).scale32).derivedFrom === 64,
				state: issues.length ? "issues" : names.length ? "present" : "missing",
				assets: names,
				animations,
				directions,
				issues,
			};
		}),
	};
}

const ratio = (raw: number, compressed: number) =>
	compressed > 0 ? Math.round((raw / compressed) * 100) / 100 : 0;

/**
 * Build the compression half of the quality report.
 *
 * Beyond the size breakdown this re-decodes the stored texture and compares it
 * to the pixels it encodes, so the studio can state — not assume — that a
 * WebP bundle really is pixel-exact. Differences confined to fully transparent
 * pixels are counted separately, because a lossy re-encode of colour no
 * renderer can see is not something a player would ever notice.
 */
export async function buildNitroCompressionReport(input: {
	json: Record<string, unknown>;
	jsonFileName: string;
	texture: Buffer;
	textureFileName: string;
	textureFormat: "png" | "webp";
	compressedSizes: { json: number; texture: number };
	bundleBytes: number;
}): Promise<CompressionReport> {
	const sharp = (await import("sharp")).default;
	const metadata = await sharp(input.texture).metadata();
	const width = Number(metadata.width ?? 0),
		height = Number(metadata.height ?? 0);
	const rawRgba =
		width * height
			? await sharp(input.texture).raw().ensureAlpha().toBuffer()
			: Buffer.alloc(0);

	// Decode the stored bytes, then re-encode with the exact importer settings
	// and compare. Reusing `encodeWebpLossless` matters: verifying with a
	// different option set than the importer uses would manufacture false
	// "mismatched" warnings, so the two can never silently drift apart.
	let mismatchedPixels = 0,
		invisibleDifferences = 0;
	if (rawRgba.length) {
		const reencoded = await encodeWebpLossless(width, height, rawRgba);
		const decoded = await sharp(reencoded).raw().ensureAlpha().toBuffer();
		for (let i = 0; i < width * height; i++) {
			const o = i * 4;
			if (
				decoded[o] === rawRgba[o] &&
				decoded[o + 1] === rawRgba[o + 1] &&
				decoded[o + 2] === rawRgba[o + 2] &&
				decoded[o + 3] === rawRgba[o + 3]
			)
				continue;
			mismatchedPixels++;
			// Colour hidden under alpha 0 cannot reach the screen, so it is
			// tracked apart from differences a player would actually show.
			if (rawRgba[o + 3] === 0) invisibleDifferences++;
		}
	}

	const webpBytes = rawRgba.length
		? (await encodeWebpLossless(width, height, rawRgba)).length
		: 0;
	const pngBytes = rawRgba.length
		? (
				await sharp(rawRgba, { raw: { width, height, channels: 4 } })
					.png({ compressionLevel: 9 })
					.toBuffer()
			).length
		: 0;

	const jsonRaw = Buffer.byteLength(JSON.stringify(input.json), "utf-8");
	const textureRaw = input.texture.length;
	const overheadBytes = Math.max(
		0,
		input.bundleBytes -
			input.compressedSizes.json -
			input.compressedSizes.texture,
	);

	return {
		bundleBytes: input.bundleBytes,
		overheadBytes,
		json: {
			fileName: input.jsonFileName,
			rawBytes: jsonRaw,
			compressedBytes: input.compressedSizes.json,
			ratio: ratio(jsonRaw, input.compressedSizes.json),
		},
		texture: {
			fileName: input.textureFileName,
			format: input.textureFormat,
			width,
			height,
			pixels: width * height,
			spriteCount: Object.keys(object(object(input.json.spritesheet).frames))
				.length,
			rawBytes: textureRaw,
			compressedBytes: input.compressedSizes.texture,
			ratio: ratio(textureRaw, input.compressedSizes.texture),
			// Only claim losslessness from the bytes themselves: a bundle that
			// arrived as a lossy VP8 WebP must not be passed off as lossless.
			lossless: input.textureFormat === "png" || isLosslessWebp(input.texture),
			mismatchedPixels,
			invisibleDifferences,
			webpEstimate: {
				bytes: webpBytes,
				savingBytes: textureRaw - webpBytes,
			},
			pngEstimate: { bytes: pngBytes },
		},
		textureShare:
			input.bundleBytes > 0
				? Math.round(
						(input.compressedSizes.texture / input.bundleBytes) * 1000,
					) / 1000
				: 0,
	};
}
