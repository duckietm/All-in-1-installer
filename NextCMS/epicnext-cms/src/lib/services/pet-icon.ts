import { readFileSync } from "node:fs";
import { resolveBundleInDir } from "@/lib/furni/bundle-file";
import { decodeTextureRgba } from "@/lib/services/imager/decode-texture";
import { cropRgba } from "@/lib/services/imager/png-decode";
import { encodePng, parseNitroBundle } from "@/lib/services/swf/nitro-builder";
import { getRuntimePath } from "@/lib/utils/runtime-path";

// Pet .nitro can live in the CMS import target or the bundled asset set.
const PET_DIRS = [
	getRuntimePath(
		/*turbopackIgnore: true*/ process.cwd(),
		"public/nitro-assets/bundled/pet",
	),
	getRuntimePath(
		/*turbopackIgnore: true*/ process.cwd(),
		"public/Gamedata/bundled/pet",
	),
];

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}
interface Asset {
	x?: number;
	y?: number;
	source?: string;
}
interface AnimLayer {
	frameSequences?: Record<string, { frames?: Record<string, { id?: number }> }>;
}
interface Visualization {
	size?: number;
	layerCount?: number;
	animations?: Record<string, { layers?: Record<string, AnimLayer> }>;
}
interface NitroJson {
	name?: string;
	assets?: Record<string, Asset>;
	spritesheet?: { frames?: Record<string, { frame: Rect; rotated?: boolean }> };
	visualizations?: Visualization[];
}
interface LayerSpec {
	letter: string;
	frameId: number;
}

// A pet is rendered as several stacked layers (a,b,c,d = body parts; sd = shadow).
// Directions present on pets are a subset of 0..7; 2 reads best as a portrait.
const DIR_PREFERENCE = [2, 0, 4, 3, 1, 7, 6, 5];

// Generated PNG icons are tiny; cache them in-process keyed by lib. The cache
// holds the in-flight promise so concurrent requests for the same pet decode
// once, and it never holds a rejection.
const iconCache = new Map<string, Promise<Buffer | null>>();

function findNitro(lib: string): string | null {
	for (const dir of PET_DIRS) {
		const p = resolveBundleInDir(/*turbopackIgnore: true*/ dir, lib);
		if (p) return p;
	}
	return null;
}

/**
 * Which layers (and at which frame id) make up the pet's IDLE pose, read from
 * the size-64 visualization's animation 0. Layers with an explicitly empty
 * frameSequences are NOT shown when idle (they belong to other animations —
 * e.g. dragon wings/fire) and must be skipped, otherwise the composite turns
 * into a junk pile. Falls back to layers a–d at frame 0 when no visualization.
 */
function idleLayerSpecs(json: NitroJson): LayerSpec[] {
	const viz = json.visualizations?.find((v) => v.size === 64);
	if (!viz?.layerCount) {
		return ["a", "b", "c", "d"].map((letter) => ({ letter, frameId: 0 }));
	}
	const anim0 = viz.animations?.["0"];
	const raw: {
		letter: string;
		alPresent: boolean;
		hasSeq: boolean;
		frameId: number;
	}[] = [];
	let anyWithSeq = false;
	for (let i = 0; i < viz.layerCount && i < 4; i++) {
		const letter = String.fromCharCode(97 + i); // a, b, c, d
		const al = anim0?.layers?.[String(i)];
		const seqKeys = al ? Object.keys(al.frameSequences ?? {}) : [];
		const hasSeq = seqKeys.length > 0;
		if (hasSeq) anyWithSeq = true;
		const frameId = hasSeq
			? Number(al?.frameSequences?.[seqKeys[0]]?.frames?.["0"]?.id ?? 0) || 0
			: 0;
		raw.push({ letter, alPresent: !!al, hasSeq, frameId });
	}
	// No idle animation defined anywhere → render every layer's static frame 0.
	if (!anyWithSeq) return raw.map((r) => ({ letter: r.letter, frameId: 0 }));
	// Idle animation exists → include only layers it drives (or layers with no
	// entry); skip layers explicitly muted in idle (empty frameSequences).
	return raw
		.filter((r) => r.hasSeq || !r.alPresent)
		.map((r) => ({ letter: r.letter, frameId: r.frameId }));
}

/** Resolve a layer asset to its spritesheet rect + placement offset. */
function resolveSprite(
	json: NitroJson,
	lib: string,
	layer: string,
	dir: number,
	frameId: number,
): { rect: Rect; ox: number; oy: number } | null {
	const assetName = `${lib}_64_${layer}_${dir}_${frameId}`;
	const asset = json.assets?.[assetName];
	if (!asset) return null;
	// `source` aliases another asset's pixels; offset stays on this asset.
	const pixelAsset = asset.source ?? assetName;
	const frameKey = `${lib}_${pixelAsset}`;
	const f = json.spritesheet?.frames?.[frameKey];
	if (!f || f.rotated || f.frame.w <= 0 || f.frame.h <= 0) return null;
	return { rect: f.frame, ox: asset.x ?? 0, oy: asset.y ?? 0 };
}

/** Alpha-over `src` (w×h RGBA) onto `dst` at (dx,dy) within a dstW-wide canvas. */
function blit(
	dst: Buffer,
	dstW: number,
	src: Buffer,
	w: number,
	h: number,
	dx: number,
	dy: number,
): void {
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const s = (y * w + x) * 4;
			const sa = src[s + 3];
			if (sa === 0) continue;
			const d = ((dy + y) * dstW + (dx + x)) * 4;
			if (sa === 255) {
				src.copy(dst, d, s, s + 4);
				continue;
			}
			const ia = 255 - sa;
			dst[d] = (src[s] * sa + dst[d] * ia) / 255;
			dst[d + 1] = (src[s + 1] * sa + dst[d + 1] * ia) / 255;
			dst[d + 2] = (src[s + 2] * sa + dst[d + 2] * ia) / 255;
			dst[d + 3] = sa + (dst[d + 3] * ia) / 255;
		}
	}
}

// Real per-breed pet colour is applied at runtime (the .nitro stores white
// palettes), so recolorable regions are baked as a saturated magenta/red
// placeholder. We tint those placeholder pixels to a sensible default colour
// per breed (an estimate, not the exact in-game value). Naturally-coloured
// pixels (white dog, brown horse, green plant) are left untouched.
const DEFAULT_PET_COLOR: Record<string, [number, number, number]> = {
	lion: [216, 166, 72],
	haloompa: [216, 166, 72],
	pig: [240, 168, 178],
	pigletbaby: [240, 168, 178],
	bunnylove: [240, 168, 190],
	dog: [196, 160, 120],
	terrier: [196, 160, 120],
	terrierbaby: [196, 160, 120],
	puppybaby: [196, 160, 120],
	bunnydepressed: [196, 160, 120],
	gnome: [196, 160, 120],
	fools: [196, 160, 120],
	cat: [156, 152, 158],
	kittenbaby: [156, 152, 158],
	monkey: [150, 108, 74],
	demonmonkey: [150, 108, 74],
	bear: [150, 112, 80],
	bearbaby: [150, 112, 80],
	horse: [162, 122, 86],
	rhino: [150, 150, 158],
	elephants: [150, 150, 158],
	spider: [96, 84, 96],
	bunnyevil: [120, 120, 128],
	pigeonevil: [120, 120, 130],
	pigeongood: [176, 176, 182],
	bunnyeaster: [220, 214, 214],
	cow: [206, 186, 162],
	chicken: [238, 226, 176],
	frog: [120, 184, 92],
	dragon: [120, 172, 110],
	croco: [128, 176, 108],
	turtle: [130, 172, 120],
	monster: [128, 176, 100],
	monsterplant: [120, 170, 96],
	pterosaur: [128, 176, 108],
	velociraptor: [128, 176, 108],
};
const FALLBACK_PET_COLOR: [number, number, number] = [190, 158, 120];

function recolorMask(
	rgba: Buffer,
	[tr, tg, tb]: [number, number, number],
): void {
	for (let i = 0; i < rgba.length; i += 4) {
		if (rgba[i + 3] === 0) continue;
		const r = rgba[i];
		const g = rgba[i + 1];
		const b = rgba[i + 2];
		// Placeholder mask: highly saturated toward magenta/red (green far below
		// red/blue). Tint to the breed colour, preserving the mask's shading.
		if (Math.max(r, b) - g > 60) {
			const l = Math.max(r, g, b) / 255;
			rgba[i] = Math.round(tr * l);
			rgba[i + 1] = Math.round(tg * l);
			rgba[i + 2] = Math.round(tb * l);
		}
	}
}

/**
 * Keep only the largest connected (8-neighbour) opaque blob — the pet body —
 * and drop detached fragments (mis-posed heads/hats, stray specks from layers
 * that don't align at this frame), then tight-crop to it. Turns "body + floating
 * junk" into a clean centered icon.
 */
function keepLargestBlob(
	rgba: Buffer,
	w: number,
	h: number,
): { rgba: Buffer; w: number; h: number } {
	const n = w * h;
	const label = new Int32Array(n).fill(-1);
	const opaque = (i: number) => rgba[i * 4 + 3] > 30;
	const comps: { id: number; size: number }[] = [];
	for (let start = 0; start < n; start++) {
		if (label[start] !== -1 || !opaque(start)) continue;
		const id = comps.length;
		let size = 0;
		const stack = [start];
		label[start] = id;
		while (stack.length) {
			const p = stack.pop() as number;
			size++;
			const x = p % w;
			const y = (p / w) | 0;
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
					const np = ny * w + nx;
					if (label[np] === -1 && opaque(np)) {
						label[np] = id;
						stack.push(np);
					}
				}
			}
		}
		comps.push({ id, size });
	}
	if (comps.length === 0) return { rgba, w, h };
	let main = comps[0];
	for (const c of comps) if (c.size > main.size) main = c;

	// Tight-crop bbox of the main blob.
	let minX = w;
	let minY = h;
	let maxX = -1;
	let maxY = -1;
	for (let p = 0; p < n; p++) {
		if (label[p] !== main.id) continue;
		const x = p % w;
		const y = (p / w) | 0;
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}
	const nw = maxX - minX + 1;
	const nh = maxY - minY + 1;
	const out = Buffer.alloc(nw * nh * 4);
	for (let y = 0; y < nh; y++) {
		for (let x = 0; x < nw; x++) {
			const sp = (minY + y) * w + (minX + x);
			if (label[sp] === main.id) {
				const o = (y * nw + x) * 4;
				const si = sp * 4;
				rgba.copy(out, o, si, si + 4);
			}
		}
	}
	return { rgba: out, w: nw, h: nh };
}

/** Composite all non-shadow body layers of one direction's base pose into a PNG. */
function composite(
	json: NitroJson,
	sheet: { width: number; rgba: Buffer },
): Buffer | null {
	const lib = (json.name ?? "").toString();
	if (!lib) return null;

	type Sprite = { rect: Rect; ox: number; oy: number };
	const bestDir = (specs: LayerSpec[]): Sprite[] => {
		let best: Sprite[] = [];
		for (const dir of DIR_PREFERENCE) {
			const resolved = specs
				.map((s) => resolveSprite(json, lib, s.letter, dir, s.frameId))
				.filter((s): s is Sprite => s !== null);
			if (resolved.length > best.length) {
				best = resolved;
				if (dir === DIR_PREFERENCE[0]) break; // front pose is good enough
			}
		}
		return best;
	};

	// Prefer the idle-pose layers; if nothing resolves, fall back to every
	// layer's static frame 0 (covers pets whose frame ids don't line up).
	let sprites = bestDir(idleLayerSpecs(json));
	if (sprites.length === 0) {
		sprites = bestDir(
			["a", "b", "c", "d"].map((letter) => ({ letter, frameId: 0 })),
		);
	}
	if (sprites.length === 0) return null;

	// Union bounding box in pet-local coords.
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const s of sprites) {
		minX = Math.min(minX, s.ox);
		minY = Math.min(minY, s.oy);
		maxX = Math.max(maxX, s.ox + s.rect.w);
		maxY = Math.max(maxY, s.oy + s.rect.h);
	}
	const cw = maxX - minX;
	const ch = maxY - minY;
	if (cw <= 0 || ch <= 0 || cw > 256 || ch > 256) return null;

	const canvas = Buffer.alloc(cw * ch * 4); // transparent
	for (const s of sprites) {
		const px = cropRgba(
			sheet.rgba,
			sheet.width,
			s.rect.x,
			s.rect.y,
			s.rect.w,
			s.rect.h,
		);
		blit(canvas, cw, px, s.rect.w, s.rect.h, s.ox - minX, s.oy - minY);
	}
	recolorMask(canvas, DEFAULT_PET_COLOR[lib] ?? FALLBACK_PET_COLOR);
	const blob = keepLargestBlob(canvas, cw, ch);
	return encodePng(blob.w, blob.h, blob.rgba);
}

/**
 * Build a composited PNG icon for a pet from its `.nitro` spritesheet, or null
 * if the pet has no bundle / no usable frames. Cached in-process.
 *
 * Async because the texture is usually WebP Lossless, which needs a real codec
 * to read back out.
 */
export async function getPetIconPng(lib: string): Promise<Buffer | null> {
	if (!/^[A-Za-z0-9_]+$/.test(lib)) return null;
	const cached = iconCache.get(lib);
	if (cached !== undefined) return cached;

	const pending = (async (): Promise<Buffer | null> => {
		const nitroPath = findNitro(lib);
		if (!nitroPath) return null;
		try {
			const { json, texture } = parseNitroBundle(
				readFileSync(/*turbopackIgnore: true*/ nitroPath),
			);
			const sheet = await decodeTextureRgba(texture);
			return composite(json as NitroJson, sheet);
		} catch {
			return null;
		}
	})();

	iconCache.set(lib, pending);
	return pending;
}
