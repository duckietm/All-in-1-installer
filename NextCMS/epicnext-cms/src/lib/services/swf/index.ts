/**
 * SWF to Nitro (.nitro) converter for Habbo furniture assets.
 *
 * Parses a SWF file, extracts sprites and metadata XML,
 * then bundles everything into the .nitro format expected
 * by the Nitro HTML5 client.
 */
import type { ConversionResult } from "@/types/furni";
import {
	parseBitsJpeg2,
	parseBitsJpeg3,
	parseBitsLossless,
	parseBitsLossless2,
	type SpriteImage,
} from "./image-decoder";
import {
	buildSpritesheet,
	createNitroBundle,
	encodePng,
	type NitroTextureFormat,
} from "./nitro-builder";
import {
	decompressSwf,
	parseBinaryData,
	parseSwfTags,
	parseSymbolClass,
	type SymbolClassResult,
	TAG_DEFINE_BINARY_DATA,
	TAG_DEFINE_BITS_JPEG2,
	TAG_DEFINE_BITS_JPEG3,
	TAG_DEFINE_BITS_LOSSLESS,
	TAG_DEFINE_BITS_LOSSLESS2,
	TAG_SYMBOL_CLASS,
} from "./swf-parser";
import {
	computeDefaultDir,
	extractPartColors,
	findChild,
	findChildren,
	parseXml,
	processAssetsXml,
	processIndex,
	processLogic,
	processManifest,
	processVisualization,
} from "./xml-processor";

export type {
	BatchConversionItem,
	BatchConversionResult,
	ConversionResult,
	FurniMetadata,
} from "@/types/furni";
// Worker-pool wrappers — run the CPU-heavy conversion off the main thread.
export {
	convertSwfToNitroAsync,
	extractIconFromSwfAsync,
} from "./conversion-pool";
// Re-export public API from submodules
export {
	buildSpritesheet,
	createNitroBundle,
	detectNitroTextureFormat,
	encodePng,
	encodeWebpLossless,
	NITRO_TEXTURE_LABEL,
	type NitroTextureFormat,
	parseNitroBundle,
} from "./nitro-builder";
export { computeDefaultDir, extractPartColors } from "./xml-processor";

// ── Main Conversion ────────────────────────────────────────────────

export async function convertSwfToNitro(
	swfBuffer: Buffer,
	classname: string,
	options?: { textureFormat?: NitroTextureFormat },
): Promise<ConversionResult> {
	const warnings: string[] = [];

	// 1. Decompress SWF
	let decompressed: Buffer;
	try {
		decompressed = decompressSwf(swfBuffer);
	} catch (err) {
		throw new Error(
			`SWF decompression failed for ${classname}: ${(err as Error).message}`,
		);
	}

	// 2. Parse tags
	const tags = parseSwfTags(decompressed);
	if (tags.length === 0) {
		throw new Error(`No tags found in SWF for ${classname}`);
	}

	// 3. Parse SymbolClass to map IDs to names
	let symbolResult: SymbolClassResult = {
		classNames: new Map(),
		symbols: new Map(),
	};
	for (const tag of tags) {
		if (tag.type === TAG_SYMBOL_CLASS) {
			symbolResult = parseSymbolClass(tag.data);
			break;
		}
	}
	const { classNames: symbolMap, symbols: allSymbols } = symbolResult;

	// 4. Extract binary data (XML configs) and images
	const binaryData = new Map<string, Buffer>();
	const rawImages = new Map<
		number,
		{ width: number; height: number; pixels: Buffer }
	>();

	for (const tag of tags) {
		switch (tag.type) {
			case TAG_DEFINE_BINARY_DATA: {
				const { id, content } = parseBinaryData(tag.data);
				const name = symbolMap.get(id) || `binary_${id}`;
				binaryData.set(name, content);
				break;
			}
			case TAG_DEFINE_BITS_LOSSLESS2: {
				const img = parseBitsLossless2(tag.data);
				rawImages.set(img.id, {
					width: img.width,
					height: img.height,
					pixels: img.pixels,
				});
				break;
			}
			case TAG_DEFINE_BITS_LOSSLESS: {
				const img = parseBitsLossless(tag.data);
				rawImages.set(img.id, {
					width: img.width,
					height: img.height,
					pixels: img.pixels,
				});
				break;
			}
			case TAG_DEFINE_BITS_JPEG2: {
				const img = parseBitsJpeg2(tag.data);
				if (img && !rawImages.has(img.id)) {
					rawImages.set(img.id, {
						width: img.width,
						height: img.height,
						pixels: img.pixels,
					});
				}
				break;
			}
			case TAG_DEFINE_BITS_JPEG3: {
				const img = parseBitsJpeg3(tag.data);
				if (img && !rawImages.has(img.id)) {
					rawImages.set(img.id, {
						width: img.width,
						height: img.height,
						pixels: img.pixels,
					});
				}
				break;
			}
		}
	}

	// 5. Strip the SymbolClass package prefix
	const prefix = `${classname}_`;

	function stripPrefix(name: string): string {
		if (name.startsWith(prefix)) return name.substring(prefix.length);
		if (name.includes(".")) return name.split(".").pop() || name;
		return name;
	}

	// 6. Parse XML data from binary tags
	let assetsXml = "";
	let indexXml = "";
	let logicXml = "";
	let visualizationXml = "";
	let manifestXml = "";

	for (const [rawName, content] of binaryData) {
		let xmlStr = content.toString("utf-8").trim();
		xmlStr = xmlStr.replace(
			/encoding="[Ii][Ss][Oo]-8859-1"/g,
			'encoding="UTF-8"',
		);
		const name = stripPrefix(rawName).toLowerCase();
		if (name.includes("manifest") || name.endsWith("_manifest")) {
			manifestXml = xmlStr;
		} else if (name.includes("assets") || name.endsWith("_assets")) {
			assetsXml = xmlStr;
		} else if (name === "index" || name.endsWith("_index")) {
			indexXml = xmlStr;
		} else if (name.includes("logic") || name.endsWith("_logic")) {
			logicXml = xmlStr;
		} else if (
			name.includes("visualization") ||
			name.endsWith("_visualization")
		) {
			visualizationXml = xmlStr;
		}
	}

	if (!assetsXml) warnings.push("No assets XML found in SWF");
	if (!logicXml) warnings.push("No logic XML found in SWF");
	if (!visualizationXml) warnings.push("No visualization XML found in SWF");

	// Build set of needed sprites from assets.xml
	const neededSprites = new Set<string>();
	if (assetsXml) {
		const assetsRoot = parseXml(assetsXml);
		if (assetsRoot) {
			const assetsNode =
				assetsRoot.tag === "assets"
					? assetsRoot
					: findChild(assetsRoot, "assets") || assetsRoot;
			for (const asset of findChildren(assetsNode, "asset")) {
				const assetName = asset.attrs.name || "";
				if (!assetName || assetName.startsWith("sh_")) continue;
				if (!asset.attrs.source) {
					neededSprites.add(assetName);
				} else {
					neededSprites.add(asset.attrs.source);
				}
			}
		}
	}

	// Map images to named sprites
	const namedImages: SpriteImage[] = [];
	for (const [id, imgData] of rawImages) {
		const rawName = symbolMap.get(id);
		if (!rawName) continue;
		const name = stripPrefix(rawName);

		if (name.startsWith("sh_")) continue;
		if (neededSprites.size > 0 && !neededSprites.has(name)) continue;

		namedImages.push({
			id,
			name,
			width: imgData.width,
			height: imgData.height,
			pixels: imgData.pixels,
		});
	}

	namedImages.sort((a, b) => a.name.localeCompare(b.name));

	// 7. Build spritesheet using bin-packing
	const {
		texture,
		format: sheetFormat,
		frames,
		width: sheetWidth,
		height: sheetHeight,
	} = await buildSpritesheet(namedImages, {
		format: options?.textureFormat ?? "webp",
	});

	// 8. Process XML into Nitro JSON structures
	const { palettes } = processAssetsXml(assetsXml);
	const manifest = processManifest(manifestXml);
	const indexData = processIndex(indexXml);
	const logic = processLogic(logicXml);
	const visualizations = processVisualization(visualizationXml);

	// Build IMAGE_SOURCES map
	const imageSources = new Map<string, string>();
	for (const [symbolName, charId] of allSymbols) {
		if (!rawImages.has(charId)) continue;
		const canonicalName = symbolMap.get(charId);
		if (!canonicalName) continue;
		if (symbolName !== canonicalName) {
			imageSources.set(stripPrefix(symbolName), stripPrefix(canonicalName));
		}
	}

	// Build assets map
	const assets: Record<
		string,
		{
			x: number;
			y: number;
			source?: string;
			flipH?: boolean;
			flipV?: boolean;
			usesPalette?: boolean;
		}
	> = {};

	for (const ma of manifest.assets) {
		assets[ma.name] = { x: ma.x, y: ma.y };
	}

	if (assetsXml) {
		const root = parseXml(assetsXml);
		if (root) {
			const assetsNode =
				root.tag === "assets" ? root : findChild(root, "assets") || root;
			for (const asset of findChildren(assetsNode, "asset")) {
				const assetName = asset.attrs.name || "";
				if (!assetName) continue;
				if (assetName.startsWith("sh_")) continue;

				const x = parseInt(asset.attrs.x || "0", 10);
				const y = parseInt(asset.attrs.y || "0", 10);

				let source = asset.attrs.source || "";
				if (source && imageSources.has(source)) {
					source = imageSources.get(source) ?? source;
				}
				if (imageSources.has(assetName)) {
					source = imageSources.get(assetName) ?? source;
				}

				const entry: (typeof assets)[string] = source
					? ({ source, x, y } as (typeof assets)[string])
					: { x, y };
				if (asset.attrs.flipH === "1") {
					entry.flipH = true;
				}
				if (asset.attrs.flipV === "1") {
					entry.flipV = true;
				}
				if (asset.attrs.usesPalette === "1") {
					entry.usesPalette = true;
				}

				assets[assetName] = entry;
			}
		}
	}

	if (Object.keys(assets).length === 0) {
		for (const img of namedImages) {
			assets[img.name] = { x: 0, y: 0 };
		}
	}

	const validSpriteNames = new Set(namedImages.map((img) => img.name));

	for (const key of Object.keys(assets)) {
		if (!validSpriteNames.has(key) && !assets[key].source) {
			delete assets[key];
		}
	}

	const sortedAssets: typeof assets = {};
	for (const key of Object.keys(assets).sort()) {
		sortedAssets[key] = assets[key];
	}

	// Build spritesheet frames
	const spritesheetFrames: Record<string, unknown> = {};
	for (const img of namedImages) {
		const frameInfo = frames.get(img.name);
		if (!frameInfo) continue;
		const frameKey = `${classname}_${img.name}`;
		spritesheetFrames[frameKey] = {
			frame: { x: frameInfo.x, y: frameInfo.y, w: frameInfo.w, h: frameInfo.h },
			rotated: false,
			trimmed: false,
			spriteSourceSize: { x: 0, y: 0, w: frameInfo.w, h: frameInfo.h },
			sourceSize: { w: frameInfo.w, h: frameInfo.h },
			pivot: { x: 0.5, y: 0.5 },
		};
	}

	// Determine visualization/logic types
	let visualizationType = indexData?.visualizationType || "furniture_static";
	let logicType = indexData?.logicType || "furniture_basic";

	if (!indexData) {
		if (
			visualizations.some(
				(v) => v.animations && Object.keys(v.animations).length > 0,
			)
		) {
			visualizationType = "furniture_animated";
			logicType = "furniture_multistate";
		}
	}

	// 9. Build final JSON
	const logicObj: Record<string, unknown> = {
		model: {
			dimensions: logic.dimensions,
			directions: logic.directions,
		},
	};
	if (logic.maskType) logicObj.maskType = logic.maskType;
	if (logic.action) logicObj.action = logic.action;
	if (logic.credits) logicObj.credits = logic.credits;
	if (logic.soundSample) logicObj.soundSample = logic.soundSample;
	if (logic.customVars) logicObj.customVars = logic.customVars;
	if (logic.particleSystems) logicObj.particleSystems = logic.particleSystems;
	if (logic.planetSystems) logicObj.planetSystems = logic.planetSystems;

	const nitroJson: Record<string, unknown> = {
		name: classname,
		visualizationType,
		logicType,
		spritesheet: {
			meta: {
				// Must match the texture member `createNitroBundle` writes, or
				// the client resolves a file that is not in the bundle.
				image: `${classname}.${sheetFormat}`,
				format: "RGBA8888",
				size: { w: sheetWidth, h: sheetHeight },
				scale: 1,
			},
			frames: spritesheetFrames,
		},
		assets: sortedAssets,
	};

	if (Object.keys(palettes).length > 0) {
		nitroJson.palettes = palettes;
	}

	nitroJson.visualizations = visualizations;
	nitroJson.logic = logicObj;

	// 10. Create .nitro bundle
	const bundle = createNitroBundle(nitroJson, texture, classname);

	return {
		bundle,
		classname,
		dimensions: logic.dimensions,
		directions: logic.directions,
		spriteCount: namedImages.length,
		warnings,
		metadata: {
			visualizationType,
			logicType,
			canstandon: logic.canstandon,
			cansiton: logic.cansiton,
			canlayon: logic.canlayon,
			hasActions: logic.hasActions,
			specialtype: indexData?.specialtype ?? 0,
			defaultdir: computeDefaultDir(logic.directions),
			partcolors: extractPartColors(visualizations),
		},
	};
}

// ── Icon Extraction from SWF ────────────────────────────────────────

export function extractIconFromSwf(
	swfBuffer: Buffer,
	classname: string,
): Buffer | null {
	try {
		const decompressed = decompressSwf(swfBuffer);
		const tags = parseSwfTags(decompressed);

		let iconSymbolMap = new Map<number, string>();
		for (const tag of tags) {
			if (tag.type === TAG_SYMBOL_CLASS) {
				const result = parseSymbolClass(tag.data);
				iconSymbolMap = result.classNames;
				break;
			}
		}

		const prefix = `${classname}_`;
		const candidates: {
			name: string;
			width: number;
			height: number;
			pixels: Buffer;
		}[] = [];

		for (const tag of tags) {
			let img: {
				id: number;
				width: number;
				height: number;
				pixels: Buffer;
			} | null = null;
			if (tag.type === TAG_DEFINE_BITS_LOSSLESS2)
				img = parseBitsLossless2(tag.data);
			else if (tag.type === TAG_DEFINE_BITS_LOSSLESS)
				img = parseBitsLossless(tag.data);
			else if (tag.type === TAG_DEFINE_BITS_JPEG2)
				img = parseBitsJpeg2(tag.data);
			else if (tag.type === TAG_DEFINE_BITS_JPEG3)
				img = parseBitsJpeg3(tag.data);
			if (!img) continue;

			const rawName = iconSymbolMap.get(img.id) || "";
			const name = rawName.startsWith(prefix)
				? rawName.substring(prefix.length)
				: rawName;
			if (!name || name.startsWith("sh_")) continue;

			if (name.includes("icon") || /^1_[a-z]_\d+_\d+$/.test(name)) {
				candidates.push({
					name,
					width: img.width,
					height: img.height,
					pixels: img.pixels,
				});
			}
		}

		if (candidates.length === 0) {
			for (const tag of tags) {
				let img: {
					id: number;
					width: number;
					height: number;
					pixels: Buffer;
				} | null = null;
				if (tag.type === TAG_DEFINE_BITS_LOSSLESS2)
					img = parseBitsLossless2(tag.data);
				else if (tag.type === TAG_DEFINE_BITS_LOSSLESS)
					img = parseBitsLossless(tag.data);
				if (!img || img.width < 2 || img.height < 2) continue;

				const rawName = iconSymbolMap.get(img.id) || "";
				const name = rawName.startsWith(prefix)
					? rawName.substring(prefix.length)
					: rawName;
				if (name.startsWith("sh_")) continue;

				candidates.push({
					name,
					width: img.width,
					height: img.height,
					pixels: img.pixels,
				});
			}
		}

		if (candidates.length === 0) return null;

		candidates.sort((a, b) => a.width * a.height - b.width * b.height);
		const icon = candidates[0];
		return encodePng(icon.width, icon.height, icon.pixels);
	} catch {
		return null;
	}
}
