const CHAR_ORDER = "abcdefghijklmnopqrstuvwxyz0123456789";

interface CharInfo {
	char: string;
	x: number;
	w: number;
}

const fontCache = new Map<
	string,
	{
		chars: CharInfo[];
		h: number;
		top: number;
		sheet: HTMLImageElement;
		avgW: number;
	}
>();

function isTransparent(
	data: Uint8ClampedArray,
	x: number,
	y: number,
	w: number,
): boolean {
	return data[(y * w + x) * 4 + 3] === 0;
}

function colEmpty(
	data: Uint8ClampedArray,
	x: number,
	w: number,
	h: number,
): boolean {
	for (let y = 0; y < h; y++) {
		if (!isTransparent(data, x, y, w)) return false;
	}
	return true;
}

function scanCharWidths(
	data: Uint8ClampedArray,
	sw: number,
	sh: number,
): CharInfo[] {
	const chars: CharInfo[] = [];
	let ci = 0;
	let x = 0;

	while (x < sw && ci < CHAR_ORDER.length) {
		// skip transparent columns
		while (x < sw && colEmpty(data, x, sw, sh)) x++;
		if (x >= sw) break;

		const start = x;
		// find end of character
		while (x < sw && !colEmpty(data, x, sw, sh)) x++;
		const end = x;

		const w = end - start;
		if (w > 0) {
			// ci increments within CHAR_ORDER bounds
			chars.push({ char: CHAR_ORDER[ci], x: start, w });
			ci++;
		}
	}

	return chars;
}

export async function getFontInfo(font: string): Promise<{
	chars: CharInfo[];
	h: number;
	top: number;
	sheet: HTMLImageElement;
	avgW: number;
}> {
	const cached = fontCache.get(font);
	if (cached) return cached;

	const img = new Image();
	img.crossOrigin = "anonymous";
	await new Promise<void>((resolve, reject) => {
		img.onload = () => resolve();
		img.onerror = () => reject(new Error(`Failed to load sprite for ${font}`));
		img.src = `/assets/fonts/sheets/${font}.gif`;
	});

	const canvas = document.createElement("canvas");
	canvas.width = img.naturalWidth;
	canvas.height = img.naturalHeight;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Could not get 2D context");
	ctx.drawImage(img, 0, 0);
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

	const chars = scanCharWidths(imageData.data, canvas.width, canvas.height);

	// measure total height by finding first/last non-empty row
	let top = canvas.height,
		bottom = 0;
	for (let y = 0; y < canvas.height; y++) {
		for (let x = 0; x < canvas.width; x++) {
			if (!isTransparent(imageData.data, x, y, canvas.width)) {
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
				break;
			}
		}
	}
	const h = bottom - top + 1;

	const avgW =
		chars.length > 0
			? Math.round(chars.reduce((s, c) => s + c.w, 0) / chars.length)
			: 12;

	const result = { chars, h, top, sheet: img, avgW };
	fontCache.set(font, result);
	return result;
}

export function getMissingChars(chars: CharInfo[], text: string): Set<string> {
	const available = new Set(chars.map((c) => c.char));
	const missing = new Set<string>();
	for (const ch of text.toLowerCase()) {
		if (ch !== " " && !available.has(ch)) {
			missing.add(ch);
		}
	}
	return missing;
}

export function renderToCanvas(
	chars: CharInfo[],
	h: number,
	top: number,
	sheet: HTMLImageElement,
	text: string,
	avgW: number,
	dpr = 1,
): HTMLCanvasElement | null {
	const map = new Map(chars.map((c) => [c.char, c]));
	const safeText = text.toLowerCase();

	let totalW = 0;
	for (const ch of safeText) {
		totalW += ch === " " ? avgW : (map.get(ch)?.w ?? 0);
	}

	if (totalW === 0) return null;

	const canvas = document.createElement("canvas");
	canvas.width = Math.round(totalW * dpr);
	canvas.height = Math.round(h * dpr);
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	ctx.scale(dpr, dpr);

	let x = 0;
	for (const ch of safeText) {
		if (ch === " ") {
			x += avgW;
		} else {
			const info = map.get(ch);
			if (info) {
				ctx.drawImage(sheet, info.x, top, info.w, h, x, 0, info.w, h);
				x += info.w;
			}
		}
	}

	return canvas;
}
